import { imageToDataUrl } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";

export const EAGLE_AGENT_URL_KEY = "infinite-canvas:eagle-agent-url";
export const EAGLE_AGENT_TOKEN_KEY = "infinite-canvas:eagle-agent-token";
export const EAGLE_API_TOKEN_KEY = "infinite-canvas:eagle-api-token";
export const DEFAULT_EAGLE_AGENT_URL = "http://127.0.0.1:23211";

export type EagleItem = {
    id: string;
    name?: string;
    ext?: string;
    width?: number;
    height?: number;
    tags?: string[];
    folders?: string[];
    annotation?: string;
    url?: string;
    size?: number;
};

export function eagleAgentUrl() {
    if (typeof window === "undefined") return DEFAULT_EAGLE_AGENT_URL;
    return window.localStorage.getItem(EAGLE_AGENT_URL_KEY)?.trim().replace(/\/$/, "") || DEFAULT_EAGLE_AGENT_URL;
}

export function eagleAgentToken() {
    return typeof window === "undefined" ? "" : window.localStorage.getItem(EAGLE_AGENT_TOKEN_KEY)?.trim() || "";
}

function eagleApiToken() {
    return typeof window === "undefined" ? "" : window.localStorage.getItem(EAGLE_API_TOKEN_KEY)?.trim() || "";
}

export function eagleAgentRequestUrl(path: string, query?: Record<string, string>) {
    const url = new URL(`${eagleAgentUrl()}${path}`);
    const token = eagleAgentToken();
    if (token) url.searchParams.set("token", token);
    const apiToken = eagleApiToken();
    if (apiToken) url.searchParams.set("eagleApiToken", apiToken);
    Object.entries(query || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
}

async function request<T>(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    const token = eagleAgentToken();
    if (token) headers.set("x-eagle-agent-token", token);
    const response = await fetch(eagleAgentRequestUrl(path), { ...init, headers });
    const body = (await response.json().catch(() => null)) as T & { error?: string } | null;
    if (!response.ok) {
        const error = new Error(body?.error || `Eagle Agent 请求失败 (${response.status})`);
        Object.assign(error, { status: response.status });
        throw error;
    }
    return body as T;
}

export async function checkEagleAgent() {
    return request<{ ok: boolean; eagle?: { version?: string; buildVersion?: string }; error?: string }>("/health");
}

export async function openCanvasInConnectedBrowser(projectId: string, nodeId: string) {
    return request<{ ok: boolean }>("/canvas/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, nodeId }),
    });
}

export async function getEagleItem(itemId: string) {
    const result = await request<{ ok: boolean; item: EagleItem }>(`/items/${encodeURIComponent(itemId)}`);
    return result.item;
}

export async function matchEagleImageFile(file: File) {
    const { selected, candidates } = await request<{ selected: EagleItem[]; candidates: EagleItem[] }>("/items/candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size }),
    });
    if (!selected.length && !candidates.length) return null;
    const checked = new Set<string>();
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    for (const group of [selected, candidates]) {
        const matches: EagleItem[] = [];
        for (const item of group) {
            if (checked.has(item.id)) continue;
            checked.add(item.id);
            const response = await fetch(eagleFileUrl(item.id));
            if (!response.ok) throw new Error("无法读取 Eagle 原图以核对拖入或粘贴的文件");
            const original = new Uint8Array(await response.arrayBuffer());
            if (original.length === fileBytes.length && original.every((value, index) => value === fileBytes[index])) matches.push(item);
        }
        if (matches.length > 1) throw new Error("匹配到多个内容相同的 Eagle Item，请复制目标 Item 的链接后粘贴");
        if (matches.length === 1) return matches[0];
    }
    return null;
}

export async function waitForEagleItem(itemId: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            return await getEagleItem(itemId);
        } catch (error) {
            if (!(error instanceof Error) || !("status" in error) || error.status !== 404) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Eagle 尚未完成入库，已保留 Item ID ${itemId}，请稍后重试同步`);
}

export function eagleFileUrl(itemId: string) {
    return eagleAgentRequestUrl(`/items/${encodeURIComponent(itemId)}/file`);
}

export function refreshEagleNodeConnection(node: CanvasNodeData): CanvasNodeData {
    const info = node.metadata;
    if (!info) return node;
    const hasEagleHistory = info.generationBatches?.some((batch) => batch.slots.some((slot) => slot.eagleItemId));
    if (!info.eagleItemId && !hasEagleHistory) return node;
    const content = info.eagleItemId ? eagleFileUrl(info.eagleItemId) : info.content;
    return {
        ...node,
        metadata: {
            ...info,
            content,
            storageKey: info.eagleItemId ? undefined : info.storageKey,
            generationBatches: info.generationBatches?.map((batch) => ({
                ...batch,
                slots: batch.slots.map((slot) => {
                    const itemId = slot.eagleItemId || (slot.id === info.currentResultId ? info.eagleItemId : undefined);
                    return itemId ? { ...slot, content: eagleFileUrl(itemId), storageKey: undefined, eagleItemId: itemId } : slot;
                }),
            })),
        },
    };
}

export function eagleThumbnailUrl(itemId: string) {
    return eagleAgentRequestUrl(`/items/${encodeURIComponent(itemId)}/thumbnail`);
}

export function eagleItemLink(itemId: string) {
    return `http://localhost:41595/item?id=${encodeURIComponent(itemId)}`;
}

export async function addImageToEagle(node: CanvasNodeData) {
    const dataUrl = await imageToDataUrl({ storageKey: node.metadata?.storageKey, url: node.metadata?.content });
    if (!dataUrl?.startsWith("data:image/")) throw new Error("当前图片无法读取为可上传的图像数据");
    const response = await request<{ ok: boolean; itemId: string }>("/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            source: { type: "base64", value: dataUrl },
            name: node.title || undefined,
            tags: ["infinite-canvas"],
            annotation: node.metadata?.prompt || node.metadata?.composerContent || undefined,
        }),
    });
    return { ...response, dataUrl };
}

export async function updateEagleItem(itemId: string, payload: Pick<EagleItem, "tags" | "annotation" | "url">) {
    return request<{ ok: boolean; item: EagleItem }>(`/items/${encodeURIComponent(itemId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
}
