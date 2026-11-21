import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { deleteStoredImages, ensureImagePreview, getImageBlob, imageToDataUrl, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { deleteStoredMedia, getMediaBlob, resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { decodeChannelModel, modelOptionName, resolveModelChannel, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { preserveNodeImageSize } from "./canvas-node-size";
import { prepareImagePrompt } from "@/services/api/image";
import type { CanvasGenerationBatch, CanvasGenerationMode, CanvasGenerationSlot, CanvasGenerationSnapshot, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

export type GenerationReferences = Pick<CanvasGenerationSnapshot, "referenceImages" | "referenceVideos" | "referenceAudios">;

export async function discardFrozenReferences(keys: string[]) {
    await Promise.allSettled([
        deleteStoredImages(keys.filter((key) => key.startsWith("image:"))),
        deleteStoredMedia(keys.filter((key) => !key.startsWith("image:"))),
    ]);
}

export async function captureGeneration(mode: CanvasGenerationMode, input: string, prompt: string, config: AiConfig, count: number, refs: GenerationReferences, signal: AbortSignal, createdKeys: string[]): Promise<CanvasGenerationSnapshot> {
    const { id, name, baseUrl, apiFormat, models } = resolveModelChannel(config, config.model);
    const modelName = modelOptionName(config.model);
    const channel = { id, name, baseUrl, apiFormat, models: models.filter((model) => model.name === modelName && model.capability === mode) };
    const { size, quality, background, reasoningEffort, systemPrompt, videoSeconds, vquality, videoGenerateAudio, videoWatermark, videoMode, audioVoice, audioFormat, audioSpeed, audioInstructions } = config;
    const scriptSettings = channel.models.some((model) => model.script) ? { systemPrompt, reasoningEffort } : {};
    const settings = {
        ...scriptSettings,
        ...(mode === "image" ? { size, quality, background, reasoningEffort, systemPrompt }
            : mode === "text" ? { reasoningEffort, systemPrompt }
            : mode === "video" ? { size, videoSeconds, vquality, videoGenerateAudio, videoWatermark, videoMode }
            : { audioVoice, audioFormat, audioSpeed, audioInstructions }),
    };
    const freezeMedia = async <T extends { url: string; storageKey?: string; name: string }>(media: T, kind: string): Promise<T> => {
        if (media.storageKey && (await getMediaBlob(media.storageKey))?.size) return { ...media, url: "" };
        const missing = () => new Error(i18n.t("agent.composer.mentions.resourceMissing", { title: media.name }));
        if (!media.url) throw missing();
        const response = await fetch(withLocalProxy(media.url), { signal });
        if (!response.ok) throw missing();
        const blob = await response.blob();
        if (!blob.size) throw missing();
        signal.throwIfAborted();
        const { storageKey } = await uploadMediaFile(blob, kind, signal);
        if (storageKey) createdKeys.push(storageKey);
        return { ...media, storageKey, url: "" };
    };
    const freezeImages = (mode === "audio" ? [] : refs.referenceImages).map(async (image) => {
        if (image.storageKey && (await getImageBlob(image.storageKey))?.size) return { ...image, dataUrl: "", url: undefined };
        const dataUrl = await imageToDataUrl({ ...image, storageKey: undefined }, { signal });
        if (!dataUrl) throw new Error(i18n.t("agent.composer.mentions.resourceMissing", { title: image.name }));
        const stored = await uploadImage(dataUrl, { signal });
        if (stored.storageKey) createdKeys.push(stored.storageKey);
        return { ...image, storageKey: stored.storageKey, dataUrl: stored.storageKey ? "" : dataUrl, url: undefined };
    });
    const freezeVideos = (mode === "video" ? refs.referenceVideos : []).map((item) => freezeMedia(item, "video"));
    const freezeAudios = (mode === "video" ? refs.referenceAudios : []).map((item) => freezeMedia(item, "audio"));
    await Promise.allSettled([...freezeImages, ...freezeVideos, ...freezeAudios]);
    const [referenceImages, referenceVideos, referenceAudios] = await Promise.all([
        Promise.all(freezeImages), Promise.all(freezeVideos), Promise.all(freezeAudios),
    ]);
    signal.throwIfAborted();
    const finalPrompt = mode === "image" ? prepareImagePrompt(config, prompt, referenceImages) : prompt;
    return { mode, input, prompt: finalPrompt, model: config.model, channel, settings, count, referenceImages, referenceVideos, referenceAudios };
}

export function configFromGeneration(snapshot: CanvasGenerationSnapshot, config: AiConfig): AiConfig | null {
    const channel = config.channels.find((item) => item.id === (decodeChannelModel(snapshot.model)?.channelId || snapshot.channel.id));
    if (!channel?.apiKey.trim() || channel.baseUrl !== snapshot.channel.baseUrl || channel.apiFormat !== snapshot.channel.apiFormat) return null;
    const modelName = modelOptionName(snapshot.model);
    const savedModel = snapshot.channel.models.find((model) => model.name === modelName && model.capability === snapshot.mode);
    const currentModel = channel.models.find((model) => model.name === modelName && model.capability === snapshot.mode);
    // Use only the trusted, local script, even when the snapshot came from an import.
    if (!savedModel || !currentModel || savedModel.script !== currentModel.script) return null;
    const { size, quality, background, reasoningEffort, systemPrompt, videoSeconds, vquality, videoGenerateAudio, videoWatermark, videoMode, audioVoice, audioFormat, audioSpeed, audioInstructions } = { ...config, ...snapshot.settings };
    return { ...config, size, quality, background, reasoningEffort, systemPrompt, videoSeconds, vquality, videoGenerateAudio, videoWatermark, videoMode, audioVoice, audioFormat, audioSpeed, audioInstructions, model: snapshot.model, count: "1", channels: [{ ...channel, models: [currentModel] }] };
}

export async function readGenerationReferences(snapshot: CanvasGenerationSnapshot, signal: AbortSignal): Promise<GenerationReferences> {
    return {
        referenceImages: await Promise.all(snapshot.referenceImages.map(async (image) => {
            const dataUrl = await imageToDataUrl(image, { signal });
            if (!dataUrl) throw new Error(image.name);
            return { ...image, dataUrl };
        })),
        referenceVideos: snapshot.referenceVideos,
        referenceAudios: snapshot.referenceAudios,
    };
}

export function generationSlot(id: string, metadata: CanvasNodeMetadata): CanvasGenerationSlot {
    const { content, storageKey, naturalWidth, naturalHeight, bytes, mimeType, durationMs } = metadata;
    return { id, status: "success", content: content || "", storageKey, naturalWidth, naturalHeight, bytes, mimeType, durationMs };
}

export function originalResult(metadata: CanvasNodeMetadata): CanvasNodeMetadata {
    if (!metadata.content) return metadata;
    const id = nanoid();
    return { ...metadata, currentResultId: id, generationBatches: [...(metadata.generationBatches || []), { id: nanoid(), slots: [generationSlot(id, metadata)] }] };
}

export function applyCurrentResult(node: CanvasNodeData, slot?: CanvasGenerationSlot): CanvasNodeData {
    const metadata = {
        ...node.metadata,
        currentResultId: slot?.id,
        content: slot?.content,
        storageKey: slot?.storageKey,
        naturalWidth: slot?.naturalWidth,
        naturalHeight: slot?.naturalHeight,
        bytes: slot?.bytes,
        mimeType: slot?.mimeType,
        durationMs: slot?.durationMs,
    };
    if (node.type !== "image" || !slot?.naturalWidth || !slot.naturalHeight || node.metadata?.currentResultId === slot.id) return { ...node, metadata };
    const size = preserveNodeImageSize(node, slot.naturalWidth, slot.naturalHeight);
    return { ...node, ...size, position: { x: node.position.x + (node.width - size.width) / 2, y: node.position.y + (node.height - size.height) / 2 }, metadata };
}

export function latestRetryBatch(node: CanvasNodeData, mode?: CanvasGenerationMode) {
    return node.metadata?.generationBatches?.findLast((batch) => batch.snapshot && (!mode || batch.snapshot.mode === mode) && batch.slots.some(retryableSlot));
}

export function retryableSlot(slot: CanvasGenerationSlot) {
    return slot.status === "error" || slot.status === "cancelled";
}

export function generationBatchStatus(batch: CanvasGenerationBatch) {
    if (batch.slots.some((slot) => slot.status === "loading")) return "loading";
    if (batch.slots.some((slot) => slot.status === "success")) return "success";
    if (batch.slots.some((slot) => slot.status === "error")) return "error";
    return "idle";
}

export function generationHistoryStatus(batches: CanvasGenerationBatch[]) {
    const active = batches.findLast((batch) => batch.slots.some((slot) => slot.status === "loading"));
    const batch = active || batches.at(-1);
    const status = batch ? generationBatchStatus(batch) : "idle" as const;
    return { status, errorDetails: status === "error" ? batch?.slots.find((slot) => slot.status === "error")?.errorDetails : undefined };
}

export function setGenerationBatch(node: CanvasNodeData, batch: CanvasGenerationBatch, primaryId?: string): CanvasNodeData {
    const history = node.metadata?.generationBatches || [];
    const batches = history.some((item) => item.id === batch.id) ? history.map((item) => item.id === batch.id ? batch : item) : [...history, batch];
    const next = { ...node, metadata: { ...node.metadata, generationBatches: batches, ...generationHistoryStatus(batches) } };
    const primary = batch.slots.find((slot) => slot.id === primaryId && slot.status === "success");
    return primary ? applyCurrentResult(next, primary) : next;
}

export function copyGenerationHistory(nodes: CanvasNodeData[], nodeIds: Map<string, string>) {
    const batchIds = new Map<string, string>();
    const slotIds = new Map<string, string>();
    const copyId = (ids: Map<string, string>, id: string) => {
        if (!ids.has(id)) ids.set(id, nanoid());
        return ids.get(id)!;
    };
    return nodes.map((node) => {
        const metadata = node.metadata;
        if (!metadata?.generationBatches?.length) return node;
        const generationBatches = metadata.generationBatches.map((batch) => ({
            ...batch,
            id: copyId(batchIds, batch.id),
            originId: batch.originId ? nodeIds.get(batch.originId) : undefined,
            slots: batch.slots.map((slot): CanvasGenerationSlot => ({
                ...slot,
                id: copyId(slotIds, slot.id),
                status: slot.status === "loading" ? "cancelled" : slot.status,
                videoTask: undefined,
            })),
        }));
        const generationOutputs: CanvasNodeMetadata["generationOutputs"] = {};
        for (const mode of ["image", "text", "video", "audio"] as const) {
            const id = metadata.generationOutputs?.[mode];
            if (id) generationOutputs[mode] = nodeIds.get(id);
        }
        return { ...node, metadata: { ...metadata, generationBatches, generationOutputs, currentResultId: slotIds.get(metadata.currentResultId || ""), ...generationHistoryStatus(generationBatches) } };
    });
}

export async function hydrateGenerationBatches(node: CanvasNodeData) {
    const history = node.metadata?.generationBatches;
    if (!history?.length) return node;
    const generationBatches = await Promise.all(history.map(async (batch) => ({
        ...batch,
        slots: await Promise.all(batch.slots.map(async (slot) => {
            if (!slot.storageKey) return slot;
            const isImage = slot.storageKey.startsWith("image:");
            if (isImage) void ensureImagePreview(slot.storageKey);
            const resolve = isImage ? resolveImageUrl : resolveMediaUrl;
            return { ...slot, content: await resolve(slot.storageKey, slot.content) };
        })),
    })));
    const current = generationBatches.flatMap((batch) => batch.slots).find((slot) => slot.id === node.metadata?.currentResultId);
    const hydrated = { ...node, metadata: { ...node.metadata, generationBatches } };
    return current ? applyCurrentResult(hydrated, current) : hydrated;
}
