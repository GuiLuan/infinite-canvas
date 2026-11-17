import { getNodeSpec } from "@/constant/canvas";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasImageGenerationType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type Position } from "@/types/canvas";

export function createCanvasNode(type: CanvasNodeTypeId, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

export function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

export function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs };
}

export function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

export function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        ...(config.background ? { background: config.background } : {}),
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

export function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
}

export function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const edge = Math.max(1, node.width, node.height);
    const size = typeof safePatch.size === "string" && !node.metadata?.content && !next.metadata?.freeResize ? nodeSizeFromRatio(safePatch.size, edge, edge) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

export function cloneNodeAsTemplate(source: CanvasNodeData, templateTitle: string): CanvasNodeData {
    const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const {
        content: _content,
        storageKey: _storageKey,
        images: _images,
        primaryImageId: _primaryImageId,
        texts: _texts,
        primaryTextId: _primaryTextId,
        videoTaskId: _videoTaskId,
        videoTaskProvider: _videoTaskProvider,
        status: _status,
        errorDetails: _errorDetails,
        naturalWidth: _naturalWidth,
        naturalHeight: _naturalHeight,
        bytes: _bytes,
        mimeType: _mimeType,
        durationMs: _durationMs,
        references: _references,
        freeResize: _freeResize,
        composerContent: _composerContent,
        ...preservedMetadata
    } = source.metadata || {};

    const isConfig = source.type === CanvasNodeType.Config;
    const nextMetadata: CanvasNodeMetadata = {
        ...preservedMetadata,
        ...(isConfig
            ? source.metadata?.composerContent !== undefined
                ? { composerContent: source.metadata.composerContent }
                : {}
            : { prompt: source.metadata?.prompt || source.metadata?.composerContent || "" }),
        status: "idle",
    };

    return {
        ...source,
        id,
        title: templateTitle,
        position: { x: source.position.x + 36, y: source.position.y + 36 },
        metadata: nextMetadata,
    };
}
