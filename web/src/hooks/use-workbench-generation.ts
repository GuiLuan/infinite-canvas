import { App } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";

import { captureGeneration, configFromGeneration, discardFrozenReferences, generationSlot, readGenerationReferences, retryableSlot } from "@/lib/canvas/canvas-generation-history";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { createVideoGenerationTask, isVideoTaskFailed, storeGeneratedVideo, waitForVideoGenerationTask } from "@/services/api/video";
import { resolveMediaUrl } from "@/services/file-storage";
import { ensureImagePreview, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { trackMediaReferences, useAssetStore } from "@/stores/use-asset-store";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { CanvasGenerationBatch, CanvasGenerationSlot, CanvasGenerationSnapshot } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";

type Mode = "image" | "video";
export type WorkbenchBatch = CanvasGenerationBatch & {
    snapshot: CanvasGenerationSnapshot;
    createdAt: number;
    updatedAt: number;
    durationMs: number;
    primaryId?: string;
    primaryAt?: number;
};

function createWorkbenchHistory(mode: Mode) {
    const storage = localforage.createInstance({ name: "infinite-canvas", storeName: `${mode}_generation_logs` });
    const useHistory = create<{ logs: WorkbenchBatch[]; busy: boolean; ready: boolean }>(() => ({ logs: [], busy: false, ready: false }));
    const jobs = new Map<AbortController, { batchId?: string; references?: ReferenceImage[]; snapshot?: CanvasGenerationSnapshot }>();
    let mutation = false;
    let loading = false;
    trackMediaReferences(() => [...jobs.values()]);
    const state = useHistory.getState;
    const set = useHistory.setState;
    const refreshBusy = () => set({ busy: mutation || jobs.size > 0 });

    async function save(batch: WorkbenchBatch) {
        const log = { ...batch, updatedAt: Date.now() };
        await storage.setItem(log.id, { ...log, slots: log.slots.map((slot) => slot.storageKey ? { ...slot, content: "" } : slot) });
        set(({ logs }) => ({ logs: [log, ...logs.filter((item) => item.id !== log.id)].sort((a, b) => b.createdAt - a.createdAt) }));
    }

    async function run(initial: WorkbenchBatch, config: AiConfig, controller: AbortController, selectNew: boolean) {
        let batch = initial;
        let writes = Promise.resolve();
        const { signal } = controller;
        const queueSave = () => {
            const value = batch;
            writes = writes.catch(() => {}).then(() => save(value));
            return writes;
        };
        const patch = (slotId: string, change: Partial<CanvasGenerationSlot>) => {
            batch = { ...batch, slots: batch.slots.map((slot) => slot.id === slotId ? { ...slot, ...change } : slot) };
            return queueSave();
        };
        const started = performance.now();
        const slots = batch.slots.filter((slot) => slot.status === "loading");
        const { snapshot } = batch;
        const references = slots.every((slot) => slot.videoTask) ? undefined : readGenerationReferences(snapshot, signal);
        const settled = await Promise.allSettled(slots.map(async (slot) => {
            const slotStarted = performance.now();
            try {
                const refs = await references;
                signal.throwIfAborted();
                let media;
                if (mode === "image") {
                    const images = refs?.referenceImages || [];
                    const result = images.length ? await requestEdit(config, snapshot.prompt, images, { signal, preparedPrompt: true }) : await requestGeneration(config, snapshot.prompt, { signal, preparedPrompt: true });
                    if (!result[0]) throw new Error(useTranslationText("imageWorkbench.missingResult"));
                    media = await uploadImage(result[0].dataUrl, { signal });
                } else {
                    const task = slot.videoTask ? { ...slot.videoTask, model: snapshot.model } : await createVideoGenerationTask(config, snapshot.prompt, refs?.referenceImages || [], { signal });
                    if (!slot.videoTask && task.provider !== "plugin") await patch(slot.id, { videoTask: { id: task.id, provider: task.provider } });
                    media = await storeGeneratedVideo(await waitForVideoGenerationTask(config, task, { signal }), signal);
                }
                if (signal.aborted && media.storageKey) await discardFrozenReferences([media.storageKey]);
                signal.throwIfAborted();
                await patch(slot.id, { ...generationSlot(slot.id, { content: media.url, storageKey: media.storageKey, naturalWidth: media.width, naturalHeight: media.height, bytes: media.bytes, mimeType: media.mimeType, durationMs: performance.now() - slotStarted }), errorDetails: undefined, videoTask: undefined });
            } catch (error) {
                await patch(slot.id, {
                    status: signal.aborted ? "cancelled" : "error",
                    errorDetails: signal.aborted ? useTranslationText("common.requestCanceled") : error instanceof Error ? error.message : useTranslationText("workbench.generationFailed"),
                    ...(isVideoTaskFailed(error) ? { videoTask: undefined } : {}),
                });
            }
        }));
        const failedWrite = settled.find((result) => result.status === "rejected");
        if (failedWrite?.status === "rejected") throw failedWrite.reason;
        const finished = batch.slots.filter((slot) => slots.some((item) => item.id === slot.id));
        const first = finished.find((slot) => slot.status === "success");
        batch = { ...batch, durationMs: batch.durationMs + performance.now() - started };
        if (first && (selectNew || !primaryBatch(state().logs))) batch = { ...batch, primaryId: first.id, primaryAt: Date.now() };
        else if (!batch.primaryId) batch = { ...batch, primaryId: batch.slots.find((slot) => slot.status === "success")?.id };
        await save(batch);
        return { successCount: finished.filter((slot) => slot.status === "success").length, failCount: finished.filter(retryableSlot).length, error: finished.find(retryableSlot)?.errorDetails };
    }

    async function load(config: AiConfig) {
        if (loading || state().busy) return;
        loading = true;
        set({ ready: false });
        try {
            const raw: WorkbenchBatch[] = [];
            await storage.iterate<WorkbenchBatch, void>((value) => {
                if (value?.snapshot?.mode === mode && Array.isArray(value.slots)) raw.push(value);
            });
            const logs = await Promise.all(raw.map(async (batch) => ({ ...batch, slots: await Promise.all(batch.slots.map(async (slot) => {
                if (!slot.storageKey) return slot;
                if (mode === "image") void ensureImagePreview(slot.storageKey);
                const resolve = mode === "image" ? resolveImageUrl : resolveMediaUrl;
                return { ...slot, content: await resolve(slot.storageKey, slot.content) };
            })) })));
            set({ logs: logs.sort((a, b) => b.createdAt - a.createdAt) });
            const recover = logs.filter((batch) => batch.slots.some((slot) => slot.status === "loading"));
            const recoveredBatches = await Promise.allSettled(recover.map(async (batch) => {
                const request = configFromGeneration(batch.snapshot, config);
                const canResume = request && mode === "video" && batch.slots.some((slot) => slot.status === "loading" && slot.videoTask);
                const recovered: WorkbenchBatch = { ...batch, slots: batch.slots.map((slot) => slot.status === "loading" && !(canResume && slot.videoTask) ? {
                    ...slot, status: "error", errorDetails: useTranslationText(slot.videoTask ? "canvas.generation.channelChanged" : "canvas.generation.interrupted"),
                } : slot) };
                await save(recovered);
                if (!canResume) return;
                const controller = new AbortController();
                jobs.set(controller, { batchId: batch.id });
                refreshBusy();
                try {
                    await run(recovered, request, controller, !batch.slots.some((slot) => slot.status === "success") && batch.id === logs[0]?.id);
                } finally {
                    jobs.delete(controller);
                    refreshBusy();
                }
            }));
            const failed = recoveredBatches.find((result) => result.status === "rejected");
            if (failed?.status === "rejected") throw failed.reason;
        } finally {
            loading = false;
            set({ ready: true });
        }
    }

    function begin(references?: ReferenceImage[]) {
        if (state().busy || !state().ready) return;
        const controller = new AbortController();
        jobs.set(controller, { references });
        refreshBusy();
        return controller;
    }

    async function edit(action: () => Promise<void>) {
        if (state().busy || !state().ready) return;
        mutation = true;
        refreshBusy();
        try { await action(); } finally { mutation = false; refreshBusy(); }
    }

    async function remove(ids: string[]) {
        const removed = state().logs.filter((batch) => ids.includes(batch.id));
        for (const batch of removed) {
            await storage.removeItem(batch.id);
            set(({ logs }) => ({ logs: logs.filter((item) => item.id !== batch.id) }));
            useAssetStore.getState().cleanupImages(batch);
        }
    }

    return { useHistory, state, load, run, begin, edit, save, remove,
        setBatch: (controller: AbortController, batch: WorkbenchBatch) => { jobs.set(controller, { batchId: batch.id, snapshot: batch.snapshot }); },
        finish: (controller: AbortController) => { jobs.delete(controller); refreshBusy(); },
        cancel: () => { jobs.forEach((_job, controller) => controller.abort()); },
    };
}

const histories = { image: createWorkbenchHistory("image"), video: createWorkbenchHistory("video") };

function primaryBatch(logs: WorkbenchBatch[]) {
    return logs.reduce<WorkbenchBatch | undefined>((current, batch) => {
        if (!batch.slots.some((slot) => slot.status === "success")) return current;
        return !current || (batch.primaryAt || 0) > (current.primaryAt || 0) ? batch : current;
    }, undefined);
}

import i18n from "@/i18n";
const useTranslationText = (key: string) => i18n.t(key);

export function useWorkbenchGeneration(mode: Mode, references: ReferenceImage[]) {
    const history = histories[mode];
    const { t } = useTranslation();
    const { message, modal } = App.useApp();
    const { logs, busy, ready } = history.useHistory();
    const [batchId, setBatchId] = useState<string>();
    const [slotId, setSlotId] = useState<string>();
    const [hidden, setHidden] = useState(false);
    const referencesRef = useRef(references);
    useLayoutEffect(() => { referencesRef.current = references; }, [references]);
    useLayoutEffect(() => trackMediaReferences(() => referencesRef.current), []);
    useEffect(() => {
        const load = () => void history.load(useConfigStore.getState().config).catch(() => message.error(t("workbench.historyStorageFailed")));
        if (useConfigStore.persist.hasHydrated()) load();
        else return useConfigStore.persist.onFinishHydration(load);
    }, [history, message, t]);

    const latest = logs[0];
    const primary = hidden ? undefined : primaryBatch(logs);
    const primarySlot = primary?.slots.find((slot) => slot.id === primary.primaryId && slot.status === "success") || primary?.slots.find((slot) => slot.status === "success");
    const selected = logs.find((batch) => batch.id === batchId);
    const active = hidden ? undefined : logs.find((batch) => batch.slots.some((slot) => slot.status === "loading"));
    const displayBatch = selected || active || primary || (hidden ? undefined : latest);
    const displaySlot = displayBatch?.slots.find((slot) => slot.id === slotId)
        || (displayBatch === primary ? primarySlot : undefined)
        || displayBatch?.slots.find((slot) => slot.id === displayBatch.primaryId)
        || displayBatch?.slots[0];
    const selectBatch = (id?: string) => { setHidden(false); setBatchId(id); setSlotId(undefined); };
    const reset = () => { setHidden(true); setBatchId(undefined); setSlotId(undefined); };
    const retryBatch = hidden ? undefined : (selected ? [selected] : logs).find((batch) => batch.slots.some(retryableSlot));
    const reportError = (error: unknown) => message.error(error instanceof Error ? error.message : t("workbench.historyStorageFailed"));

    const generate = async ({ prompt, config, count, original, retryId, agentTaskId }: { prompt: string; config: AiConfig; count: number; original?: WorkbenchBatch; retryId?: string; agentTaskId?: string }) => {
        const updateAgent = useWorkbenchAgentStore.getState().updateTask;
        const controller = history.begin(original ? undefined : references);
        if (!controller) {
            if (agentTaskId) updateAgent(agentTaskId, { status: "failed", error: t(`${mode}Workbench.busy`) });
            return;
        }
        if (agentTaskId) updateAgent(agentTaskId, { status: "running", error: undefined });
        const createdKeys: string[] = [];
        try {
            const matching = original && history.state().logs.find((batch) => batch.id === original.id);
            if (original && !matching) return;
            const snapshot = matching?.snapshot || await captureGeneration(mode, prompt, prompt.trim(), config, count, { referenceImages: references, referenceVideos: [], referenceAudios: [] }, controller.signal, createdKeys);
            const request = configFromGeneration(snapshot, useConfigStore.getState().config);
            if (!request) throw new Error(t("canvas.generation.channelChanged"));
            controller.signal.throwIfAborted();
            const batch: WorkbenchBatch = matching ? { ...matching, slots: matching.slots.map((slot) => retryableSlot(slot) && (!retryId || retryId === slot.id) ? { ...slot, content: "", status: "loading", errorDetails: undefined } : slot) }
                : { id: nanoid(), snapshot, createdAt: Date.now(), updatedAt: Date.now(), durationMs: 0, slots: Array.from({ length: count }, () => ({ id: nanoid(), content: "", status: "loading" })) };
            if (!batch.slots.some((slot) => slot.status === "loading")) return;
            history.setBatch(controller, batch);
            await history.save(batch);
            if (!matching) createdKeys.length = 0;
            selectBatch();
            const outcome = await history.run(batch, request, controller, !matching);
            if (agentTaskId) updateAgent(agentTaskId, { ...outcome, status: outcome.successCount ? "succeeded" : "failed", error: outcome.successCount ? undefined : outcome.error });
            if (outcome.successCount) message.success(t(matching ? "workbench.retrySuccess" : `${mode}Workbench.generated`));
            else if (!controller.signal.aborted) message.error(outcome.error || t("workbench.generationFailed"));
        } catch (error) {
            if (agentTaskId) updateAgent(agentTaskId, { status: "failed", error: controller.signal.aborted ? t("common.requestCanceled") : error instanceof Error ? error.message : t("workbench.generationFailed") });
            if (!controller.signal.aborted) void reportError(error);
        } finally {
            if (createdKeys.length) await discardFrozenReferences(createdKeys);
            history.finish(controller);
        }
    };

    const setPrimary = (batch: WorkbenchBatch, id: string) => history.edit(async () => {
        await history.save({ ...batch, primaryId: id, primaryAt: Date.now() });
        selectBatch();
    }).catch(reportError);
    const deleteSlot = (batch: WorkbenchBatch, slot: CanvasGenerationSlot) => modal.confirm({
        title: t("workbench.deleteResult"), okText: t("common.delete"), okButtonProps: { danger: true }, cancelText: t("common.cancel"),
        onOk: () => history.edit(async () => {
            const current = history.state().logs.find((item) => item.id === batch.id);
            if (!current) return;
            const slots = current.slots.filter((item) => item.id !== slot.id);
            if (!slots.length) await history.remove([current.id]);
            else {
                const primaryId = current.primaryId === slot.id ? slots.find((item) => item.status === "success")?.id : current.primaryId;
                await history.save({ ...current, slots, primaryId });
                useAssetStore.getState().cleanupImages(slot);
            }
            setSlotId(undefined);
        }).catch(reportError),
    });
    const deleteBatches = (ids: string[]) => history.edit(() => history.remove(ids)).catch(reportError);

    return { logs, busy, ready, active, selected, primaryBatch: primary, primarySlot, displaySlot, displayBatch, retryBatch, selectBatch, setSlotId, reset, generate, setPrimary, deleteSlot, deleteBatches, cancel: history.cancel };
}
