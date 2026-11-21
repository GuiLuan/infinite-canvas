import { imageToDataUrl } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";

export const EAGLE_AGENT_URL_KEY = "infinite-canvas:eagle-agent-url";
export const EAGLE_AGENT_TOKEN_KEY = "infinite-canvas:eagle-agent-token";
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

export function eagleAgentRequestUrl(path: string, query?: Record<string, string>) {
    const url = new URL(`${eagleAgentUrl()}${path}`);
    const token = eagleAgentToken();
    if (token) url.searchParams.set("token", token);
    Object.entries(query || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
}

async function request<T>(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    const token = eagleAgentToken();
    if (token) headers.set("x-eagle-agent-token", token);
    const response = await fetch(eagleAgentRequestUrl(path), { ...init, headers });
    const body = (await response.json().catch(() => null)) as T & { error?: string } | null;
    if (!response.ok) throw new Error(body?.error || `Eagle Agent 请求失败 (${response.status})`);
    return body as T;
}

export async function checkEagleAgent() {
    return request<{ ok: boolean; eagle?: { version?: string; buildVersion?: string }; error?: string }>("/health");
}

export async function getEagleItem(itemId: string) {
    const result = await request<{ ok: boolean; item: EagleItem }>(`/items/${encodeURIComponent(itemId)}`);
    return result.item;
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
