import localforage from "localforage";
import { nanoid } from "nanoid";

import { withLocalProxy } from "@/stores/use-config-store";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();

export async function uploadMediaFile(input: string | Blob, prefix = "file", signal?: AbortSignal): Promise<UploadedFile> {
    signal?.throwIfAborted();
    const blob = typeof input === "string" ? await (await fetch(withLocalProxy(input), { signal })).blob() : input;
    const storageKey = `${prefix}:${nanoid()}`;
    const url = URL.createObjectURL(blob);
    try {
        const kind = blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : undefined;
        const meta = kind ? await readMediaMeta(url, kind, signal) : {};
        signal?.throwIfAborted();
        await store.setItem(storageKey, blob);
        if (signal?.aborted) {
            await store.removeItem(storageKey).catch(() => undefined);
            signal.throwIfAborted();
        }
        objectUrls.set(storageKey, url);
        return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedMedia(readUsed: () => unknown, removedData: unknown) {
    const candidates = collectMediaStorageKeys(removedData);
    if (!candidates.size) return;
    const usedKeys = new Set<string>();
    await Promise.all(["image_generation_logs", "video_generation_logs"].map((storeName) =>
        localforage.createInstance({ name: "infinite-canvas", storeName }).iterate((value) => { collectMediaStorageKeys(value, usedKeys); }),
    ));
    collectMediaStorageKeys(readUsed(), usedKeys);
    await deleteStoredMedia([...candidates].filter((key) => !usedKeys.has(key)));
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":") && !value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readMediaMeta(url: string, kind: "audio" | "video", signal?: AbortSignal) {
    return new Promise<Pick<UploadedFile, "width" | "height" | "durationMs">>((resolve, reject) => {
        signal?.throwIfAborted();
        const media = document.createElement(kind);
        const cleanup = () => {
            signal?.removeEventListener("abort", abort);
            media.onloadedmetadata = media.onerror = null;
            media.removeAttribute("src");
            media.load();
        };
        const abort = () => {
            cleanup();
            reject(signal?.reason);
        };
        const done = () => {
            const durationMs = Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : undefined;
            const size = media instanceof HTMLVideoElement ? { width: media.videoWidth || 1280, height: media.videoHeight || 720 } : {};
            cleanup();
            resolve({ ...size, durationMs });
        };
        signal?.addEventListener("abort", abort, { once: true });
        media.onloadedmetadata = media.onerror = done;
        media.src = url;
    });
}
