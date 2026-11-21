import { useState } from "react";
import { ArrowUp, Maximize2, Square } from "lucide-react";
import { Button, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, resolveModelForCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import { getGroupResourceNodes, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasNodeReferenceBar } from "./canvas-node-reference-bar";
import { generationShortcutLabel } from "@/lib/keyboard-event";
import { latestRetryBatch } from "@/lib/canvas/canvas-generation-history";
import { unreadyImageReferences } from "./canvas-node-generation";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onRetry: (node: CanvasNodeData, mode: CanvasGenerationMode) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    nodes: CanvasNodeData[];
    connectedNodes?: CanvasNodeData[];
    onDisconnectReference?: (fromNodeId: string, toNodeId: string) => void;
    onStartReferenceSelection?: (nodeId: string) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
    modeOverride?: CanvasNodeGenerationMode; // Plugin nodes set their generation type through useBuiltinPanel.mode.
};

export function CanvasNodePromptPanel({ node, nodes, isRunning, onPromptChange, onConfigChange, onGenerate, onRetry, onStop, mentionReferences = [], connectedNodes = [], onDisconnectReference, onStartReferenceSelection, onImageSettingsOpenChange, modeOverride }: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const generationShortcut = globalConfig.generationShortcut;
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const isEditingExistingContent = hasTextContent;
    const prompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
    const [expanded, setExpanded] = useState(false);

    const updatePrompt = (value: string) => {
        if (isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const incoming = connectedNodes.filter((input) => input.id !== node.id);
    const unready = mode === "audio" ? [] : unreadyImageReferences(incoming, nodes.filter((input) => input.id !== node.id));
    const hasReadyImageReference = incoming.flatMap((input) => input.type === CanvasNodeType.Group ? getGroupResourceNodes(input.id, nodes) : [input])
        .some((input) => input.id !== node.id && input.type === CanvasNodeType.Image && Boolean(input.metadata?.content));
    const hasTextReference = incoming.flatMap((input) => input.type === CanvasNodeType.Group ? getGroupResourceNodes(input.id, nodes) : [input])
        .some((input) => input.id !== node.id && input.type === CanvasNodeType.Text && Boolean((input.metadata?.content || input.metadata?.prompt)?.trim()));
    const canSubmit = !unready.length && (Boolean(prompt.trim()) || hasTextReference || (mode !== "audio" && hasReadyImageReference));
    const retry = latestRetryBatch(node, mode);
    const generateLabel = t(node.metadata?.content || node.metadata?.generationBatches?.some((batch) => batch.slots.some((slot) => slot.status === "success")) ? "canvas.promptPanel.regenerate" : "canvas.promptPanel.generate");
    const submit = () => {
        if (!isRunning && canSubmit) onGenerate(node.id, mode, prompt);
    };

    const openExpandedEditor = () => {
        setExpanded(true);
    };

    return (
        <div
            data-canvas-no-zoom
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasNodeReferenceBar nodeId={node.id} nodes={nodes} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={onStartReferenceSelection} />
            <CanvasPromptChipInput
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                generationShortcut={generationShortcut}
                className="thin-scrollbar h-40 w-full cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: "transparent", color: theme.node.text }}
                placeholder={t(`canvas.promptPanel.${mode === "text" && hasTextContent ? "editText" : mode}`)}
            />

            {(unready.length > 0 || (mode === "image" && hasReadyImageReference)) && <div className="mt-1 px-1 text-[11px] opacity-55">{unready.length ? t("canvas.promptPanel.incomingImagesNotReady", { names: unready.join("、") }) : t("canvas.promptPanel.incomingImagesReady")}</div>}
            <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <Tooltip title={t("canvas.promptPanel.expandEditor")}>
                        <Button type="text" className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0" style={{ color: theme.node.text }} icon={<Maximize2 className="size-3.5" />} onClick={openExpandedEditor} aria-label={t("canvas.promptPanel.expandEditor")} />
                    </Tooltip>
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {!isRunning && generationShortcut !== "disabled" && <span className="shrink-0 text-[11px] opacity-55">{t("canvas.promptPanel.shortcutHint", { shortcut: generationShortcutLabel(generationShortcut) })}</span>}
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px] !min-w-0" />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-8 !max-w-[170px] !justify-start !rounded-full !px-2"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px] !min-w-0" />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-8 !max-w-[220px] !justify-start !rounded-full !px-2" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px] !min-w-0" />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-8 !max-w-[170px] !justify-start !rounded-full !px-2" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px] !min-w-0" />
                            <CanvasTextSettingsPopover config={config} count={node.metadata?.textCount || 1} onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })} onCountChange={(textCount) => onConfigChange(node.id, { textCount })} buttonClassName="!h-8 !max-w-[170px] !justify-start !rounded-full !px-2" />
                        </>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {!isRunning && retry && <Button type="text" size="small" className="!h-8 !px-2" onClick={() => onRetry(node, mode)}>{t("common.retry")}</Button>}
                    <Tooltip title={isRunning ? t("canvas.promptPanel.stopGeneration") : generateLabel}>
                        <Button
                            type="primary"
                            size="small"
                            className="!h-8 !w-8 !min-w-8 !rounded-full !p-0"
                            danger={isRunning}
                            disabled={!isRunning && !canSubmit}
                            onClick={() => (isRunning ? onStop(node.id) : submit())}
                            aria-label={isRunning ? t("canvas.promptPanel.stopGeneration") : generateLabel}
                            icon={isRunning ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-4" />}
                        />
                    </Tooltip>
                </div>
            </div>
            <Modal title={t("canvas.promptPanel.editorTitle")} open={expanded} centered width={760} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasNodeReferenceBar nodeId={node.id} nodes={nodes} connectedNodes={connectedNodes} onDisconnect={onDisconnectReference} onStartSelection={(nodeId) => { setExpanded(false); onStartReferenceSelection?.(nodeId); }} />
                    <CanvasPromptChipInput
                        value={prompt}
                        references={mentionReferences}
                        onChange={updatePrompt}
                        generationShortcut={generationShortcut}
                        onSubmit={submit}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={t(`canvas.promptPanel.${mode === "text" && hasTextContent ? "editText" : mode}`)}
                    />
                </div>
            </Modal>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...globalConfig,
        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),
        systemPrompt: node.metadata?.systemPrompt ?? globalConfig.systemPrompt,
        reasoningEffort: node.metadata?.reasoningEffort || globalConfig.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        videoMode: node.metadata?.videoMode || globalConfig.videoMode || defaultConfig.videoMode,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoMode") return { videoMode: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
