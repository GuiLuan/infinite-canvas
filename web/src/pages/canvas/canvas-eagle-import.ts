import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { originalResult } from "@/lib/canvas/canvas-generation-history";
import { eagleFileUrl, getEagleItem, matchEagleImageFile, type EagleItem } from "@/services/api/eagle";
import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";

export type CanvasTransfer = { texts: string[]; files: File[] };

export function readCanvasTransfer(data: DataTransfer): CanvasTransfer {
    return {
        texts: Array.from(data.types).filter((type) => type !== "Files").map((type) => data.getData(type)).filter(Boolean),
        files: Array.from(data.files),
    };
}

export function eagleItemIds(texts: string[]) {
    const ids = new Set<string>();
    for (const text of texts) {
        const html = new DOMParser().parseFromString(text, "text/html");
        const values = [
            ...text.split(/\r?\n/),
            ...(text.match(/(?:https?:\/\/|eagle:\/\/|file:\/\/\/)[^\s<>"']+/gi) || []),
            ...Array.from(html.querySelectorAll("[href],[src]")).flatMap((node) => [node.getAttribute("href") || "", node.getAttribute("src") || ""]),
        ];
        for (const value of values) {
            const trimmed = value.trim().replace(/^["']|["']$/g, "");
            try {
                const url = new URL(trimmed);
                if (url.protocol === "eagle:" && url.hostname === "item") {
                    const id = url.pathname.slice(1);
                    if (/^[a-z0-9]+$/i.test(id)) ids.add(id);
                }
                if (["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.port === "41595" && url.pathname === "/item") {
                    const id = url.searchParams.get("id") || "";
                    if (/^[a-z0-9]+$/i.test(id)) ids.add(id);
                }
                if (url.protocol !== "file:" && !/^[a-z]:[\\/]/i.test(trimmed)) continue;
            } catch {
                if (!/^(?:[a-z]:[\\/]|\/)/i.test(trimmed)) continue;
            }
            let filePath = trimmed;
            try { filePath = decodeURIComponent(filePath); } catch { /* Keep literal paths containing percent signs. */ }
            const match = filePath.match(/\.library[\\/]images[\\/]([a-z0-9]+)\.info[\\/]/i);
            if (match) ids.add(match[1]);
        }
    }
    return [...ids];
}

function eagleImageNode(item: EagleItem, position: Position): CanvasNodeData {
    if (!item.width || !item.height) throw new Error(`Eagle Item ${item.id} 缺少图片尺寸，无法添加图片节点`);
    const size = fitNodeSize(item.width, item.height);
    const node = createCanvasNode(CanvasNodeType.Image, position, originalResult({
        content: eagleFileUrl(item.id),
        eagleItemId: item.id,
        naturalWidth: item.width,
        naturalHeight: item.height,
        bytes: item.size,
        mimeType: item.ext ? `image/${item.ext.toLowerCase() === "jpg" ? "jpeg" : item.ext.toLowerCase()}` : undefined,
        status: "success",
    }));
    return { ...node, title: item.name || node.title, ...size, position: { x: position.x - size.width / 2, y: position.y - size.height / 2 } };
}

export async function resolveEagleTransfer(transfer: CanvasTransfer, position: Position) {
    const ids = eagleItemIds(transfer.texts);
    const enabled = Boolean(getNodeDefinition("eagle:item"));
    if (ids.length && !enabled) throw new Error("请先在节点插件中启用 Eagle 资源插件，再拖入或粘贴 Eagle 素材");
    if (!enabled) return { nodes: [], files: transfer.files };
    const items: EagleItem[] = [];
    const files: File[] = [];
    if (ids.length) {
        items.push(...await Promise.all(ids.map(getEagleItem)));
    } else {
        for (const file of transfer.files) {
            const item = file.type.startsWith("image/") ? await matchEagleImageFile(file) : null;
            if (item) items.push(item);
            else files.push(file);
        }
    }
    const unique = [...new Map(items.map((item) => [item.id, item])).values()];
    const nodes = unique.map((item, index) => eagleImageNode(item, { x: position.x + index * 40, y: position.y + index * 40 }));
    return { nodes, files };
}
