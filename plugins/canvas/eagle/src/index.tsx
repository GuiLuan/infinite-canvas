import { definePlugin, useEffect, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeContext, CanvasNodeData, CanvasNodePanelProps } from "@infinite-canvas/plugin-sdk";

const DEFAULT_AGENT_URL = "http://127.0.0.1:23211";
const AGENT_URL_KEY = "infinite-canvas:eagle-agent-url";
const AGENT_TOKEN_KEY = "infinite-canvas:eagle-agent-token";

type EagleMetadata = {
    eagleItemId?: string;
    eagleAgentUrl?: string;
    eagleAgentToken?: string;
    eagleThumbnailUrl?: string;
    eagleStatus?: "idle" | "loading" | "ready" | "error";
    eagleError?: string;
    eagleTags?: string[];
    eagleAnnotation?: string;
    eagleSourceUrl?: string;
};

function metadata(node: CanvasNodeData) {
    return (node.metadata || {}) as EagleMetadata;
}

function agentUrl(node: CanvasNodeData) {
    const configured = metadata(node).eagleAgentUrl || (typeof window !== "undefined" ? window.localStorage.getItem(AGENT_URL_KEY) : "") || DEFAULT_AGENT_URL;
    return configured.replace(/\/$/, "");
}

function agentToken(node: CanvasNodeData) {
    return metadata(node).eagleAgentToken || (typeof window !== "undefined" ? window.localStorage.getItem(AGENT_TOKEN_KEY) : "") || "";
}

function agentRequestUrl(node: CanvasNodeData, path: string) {
    const url = new URL(`${agentUrl(node)}${path}`);
    const token = agentToken(node);
    if (token) url.searchParams.set("token", token);
    return url.toString();
}

function parseItemId(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
        const url = new URL(trimmed);
        if (url.searchParams.get("id")) return url.searchParams.get("id") || "";
        if (url.protocol === "eagle:" && url.hostname === "item") return url.pathname.slice(1);
        const match = url.pathname.match(/\/item\/([^/]+)/);
        if (match) return match[1];
    } catch {
        const match = trimmed.match(/^eagle:\/\/item\/([^/?#]+)/i);
        if (match) return match[1];
    }
    return trimmed;
}

async function readItem(node: CanvasNodeData, itemId: string) {
    const response = await fetch(agentRequestUrl(node, `/items/${encodeURIComponent(itemId)}`));
    const body = (await response.json().catch(() => null)) as { item?: { name?: string; width?: number; height?: number; tags?: string[]; annotation?: string; url?: string }; error?: string } | null;
    if (!response.ok || !body?.item) throw new Error(body?.error || "Eagle Agent 未返回 Item");
    return body.item;
}

function stop(e: { stopPropagation: () => void }) {
    e.stopPropagation();
}

function EagleContent({ ctx }: CanvasNodeContentProps) {
    const info = metadata(ctx.node);
    const itemId = info.eagleItemId || "";
    const [status, setStatus] = useState(info.eagleStatus || (itemId ? "loading" : "idle"));
    const [error, setError] = useState(info.eagleError || "");
    const imageUrl = itemId ? agentRequestUrl(ctx.node, `/items/${encodeURIComponent(itemId)}/file`) : "";

    useEffect(() => {
        let active = true;
        if (!itemId) {
            setStatus("idle");
            return () => {
                active = false;
            };
        }
        setStatus("loading");
        fetch(agentRequestUrl(ctx.node, "/health"))
            .then(async (response) => {
                if (!response.ok) throw new Error("Eagle Agent 未启动");
                const item = await readItem(ctx.node, itemId);
                if (!active) return;
                setStatus("ready");
                setError("");
                ctx.updateMetadata({ eagleStatus: "ready", eagleError: undefined, eagleThumbnailUrl: imageUrl, eagleTags: item.tags, eagleAnnotation: item.annotation, eagleSourceUrl: item.url, naturalWidth: item.width, naturalHeight: item.height });
                ctx.updateNode({ type: "image", title: item.name || ctx.node.title });
                ctx.updateMetadata({ content: imageUrl, storageKey: undefined });
            })
            .catch((reason) => {
                if (!active) return;
                const message = reason instanceof Error ? reason.message : String(reason);
                setStatus("error");
                setError(message);
                ctx.updateMetadata({ eagleStatus: "error", eagleError: message });
            });
        return () => {
            active = false;
        };
    }, [itemId]);

    if (!itemId) return <div style={{ color: ctx.theme.node.muted, fontSize: 13, padding: 16 }}>打开面板粘贴 Eagle Item 链接</div>;
    if (status === "error") return <div data-canvas-no-zoom style={{ color: ctx.theme.node.text, display: "grid", gap: 8, padding: 16, fontSize: 13 }}><strong>Eagle 资源暂时不可用</strong><span style={{ color: ctx.theme.node.muted }}>{error || "请确认 Eagle 和 Eagle Agent 已启动"}</span><button type="button" onMouseDown={stop} onClick={() => ctx.openPanel()} style={{ border: 0, background: "transparent", color: ctx.theme.node.text, cursor: "pointer", textAlign: "left", padding: 0 }}>打开配置</button></div>;
    return <div data-canvas-no-zoom style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", overflow: "hidden" }}><img src={imageUrl} alt={ctx.node.title} draggable={false} onError={() => { setStatus("error"); setError("原图读取失败"); }} style={{ width: "100%", height: "100%", objectFit: "contain", opacity: status === "loading" ? 0.45 : 1 }} /></div>;
}

function EaglePanel({ ctx, onClose }: CanvasNodePanelProps) {
    const info = metadata(ctx.node);
    const [link, setLink] = useState(info.eagleItemId ? `http://localhost:41595/item?id=${info.eagleItemId}` : "");
    const [url, setUrl] = useState(info.eagleAgentUrl || (typeof window !== "undefined" ? window.localStorage.getItem(AGENT_URL_KEY) : "") || DEFAULT_AGENT_URL);
    const [token, setToken] = useState(info.eagleAgentToken || (typeof window !== "undefined" ? window.localStorage.getItem(AGENT_TOKEN_KEY) : "") || "");
    const [annotation, setAnnotation] = useState(info.eagleAnnotation || "");
    const [tags, setTags] = useState((info.eagleTags || []).join(", "));
    const [sourceUrl, setSourceUrl] = useState(info.eagleSourceUrl || "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [loadedId, setLoadedId] = useState("");
    const [original, setOriginal] = useState<{ annotation: string; tags: string; url: string } | null>(null);

    const load = async (itemId: string) => {
        const nextNode = { ...ctx.node, metadata: { ...ctx.node.metadata, eagleAgentUrl: url.trim().replace(/\/$/, ""), eagleAgentToken: token.trim() } };
        const item = await readItem(nextNode, itemId);
        const values = { annotation: item.annotation || "", tags: (item.tags || []).join(", "), url: item.url || "" };
        setAnnotation(values.annotation);
        setTags(values.tags);
        setSourceUrl(values.url);
        setOriginal(values);
        setLoadedId(itemId);
    };

    useEffect(() => {
        if (!info.eagleItemId) return;
        let active = true;
        setBusy(true);
        const nextNode = { ...ctx.node, metadata: { ...ctx.node.metadata, eagleAgentUrl: url.trim().replace(/\/$/, ""), eagleAgentToken: token.trim() } };
        readItem(nextNode, info.eagleItemId).then((item) => {
            if (!active) return;
            const values = { annotation: item.annotation || "", tags: (item.tags || []).join(", "), url: item.url || "" };
            setAnnotation(values.annotation);
            setTags(values.tags);
            setSourceUrl(values.url);
            setOriginal(values);
            setLoadedId(info.eagleItemId || "");
        }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
            .finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [info.eagleItemId]);

    const save = async () => {
        const itemId = parseItemId(link);
        if (!itemId) return setError("请输入 Eagle Item 链接或 Item ID");
        setBusy(true);
        setError("");
        const nextNode = { ...ctx.node, metadata: { ...ctx.node.metadata, eagleAgentUrl: url.trim().replace(/\/$/, ""), eagleAgentToken: token.trim() } };
        try {
            if (loadedId !== itemId || !original) {
                await load(itemId);
                return;
            }
            const response = await fetch(agentRequestUrl(nextNode, `/items/${encodeURIComponent(itemId)}`));
            const body = (await response.json().catch(() => null)) as { item?: { name?: string; width?: number; height?: number; tags?: string[]; annotation?: string; url?: string }; error?: string } | null;
            if (!response.ok || !body?.item) throw new Error(body?.error || "无法读取 Eagle Item");
            const canvasUrl = typeof window !== "undefined" ? (() => { const next = new URL(window.location.href); next.search = ""; next.hash = ""; next.searchParams.set("node", ctx.node.id); return next.toString(); })() : "";
            const nextTags = tags.split(",").map((item) => item.trim()).filter(Boolean);
            const nextAnnotation = annotation;
            const nextUrl = sourceUrl.trim() || (original.url ? "" : canvasUrl);
            const changes: { tags?: string[]; annotation?: string; url?: string } = {};
            if (tags !== original.tags) changes.tags = nextTags;
            if (annotation !== original.annotation) changes.annotation = nextAnnotation;
            if (nextUrl !== original.url) changes.url = nextUrl;
            const update = Object.keys(changes).length ? await fetch(agentRequestUrl(nextNode, `/items/${encodeURIComponent(itemId)}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) }) : null;
            const updateBody = (await update?.json().catch(() => null)) as { error?: string } | null;
            if (update && !update.ok) throw new Error(updateBody?.error || "Eagle Item 信息同步失败");
            if (typeof window !== "undefined") {
                window.localStorage.setItem(AGENT_URL_KEY, url.trim().replace(/\/$/, ""));
                token.trim() ? window.localStorage.setItem(AGENT_TOKEN_KEY, token.trim()) : window.localStorage.removeItem(AGENT_TOKEN_KEY);
            }
            ctx.updateNode({ type: "image", title: body.item.name || ctx.node.title, width: body.item.width || ctx.node.width, height: body.item.height || ctx.node.height });
            ctx.updateMetadata({ content: agentRequestUrl(nextNode, `/items/${encodeURIComponent(itemId)}/file`), storageKey: undefined, eagleItemId: itemId, eagleAgentUrl: url.trim().replace(/\/$/, ""), eagleAgentToken: token.trim(), eagleStatus: "ready", eagleError: undefined, eagleThumbnailUrl: agentRequestUrl(nextNode, `/items/${encodeURIComponent(itemId)}/thumbnail`), eagleTags: nextTags, eagleAnnotation: nextAnnotation, eagleSourceUrl: nextUrl, naturalWidth: body.item.width, naturalHeight: body.item.height });
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    return <div data-canvas-no-zoom onMouseDown={stop} style={{ display: "grid", gap: 10, padding: 14, background: ctx.theme.node.panel, border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 12, color: ctx.theme.node.text, fontSize: 13 }}><label style={{ display: "grid", gap: 5 }}>Eagle Item 链接<input value={link} onChange={(e) => setLink(e.target.value)} placeholder="http://localhost:41595/item?id=..." style={{ background: "transparent", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, color: "inherit", padding: "7px 8px" }} /></label><label style={{ display: "grid", gap: 5 }}>Eagle Agent 地址<input value={url} onChange={(e) => { setUrl(e.target.value); setLoadedId(""); }} style={{ background: "transparent", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, color: "inherit", padding: "7px 8px" }} /></label><label style={{ display: "grid", gap: 5 }}>Agent Token（可选）<input value={token} onChange={(e) => { setToken(e.target.value); setLoadedId(""); }} type="password" style={{ background: "transparent", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, color: "inherit", padding: "7px 8px" }} /></label><label style={{ display: "grid", gap: 5 }}>描述<textarea rows={4} disabled={busy || !loadedId || loadedId !== parseItemId(link)} value={annotation} onChange={(e) => setAnnotation(e.target.value)} placeholder="同步到 Eagle 的描述" style={{ background: "transparent", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, color: "inherit", padding: "7px 8px" }} /></label><label style={{ display: "grid", gap: 5 }}>标签<input disabled={busy || !loadedId || loadedId !== parseItemId(link)} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="标签1, 标签2" style={{ background: "transparent", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, color: "inherit", padding: "7px 8px" }} /></label><label style={{ display: "grid", gap: 5 }}>来源 URL（留空则写入当前画布节点链接）<input disabled={busy || !loadedId || loadedId !== parseItemId(link)} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." style={{ background: "transparent", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, color: "inherit", padding: "7px 8px" }} /></label>{error ? <span style={{ color: "#ef4444" }}>{error}</span> : null}<button type="button" disabled={busy} onClick={() => void save()} style={{ border: 0, borderRadius: 6, padding: "8px 10px", background: ctx.theme.toolbar.activeBg, color: ctx.theme.node.text, cursor: busy ? "wait" : "pointer" }}>{busy ? "处理中…" : loadedId && loadedId === parseItemId(link) ? "保存并连接" : "读取 Eagle 信息"}</button></div>;
}

function openEagle(ctx: CanvasNodeContext) {
    const itemId = metadata(ctx.node).eagleItemId;
    if (itemId) window.open(`http://localhost:41595/item?id=${encodeURIComponent(itemId)}`, "_blank");
}

export default definePlugin({
    id: "eagle",
    name: "Eagle 资源",
    version: "0.1.2",
    description: "以 Eagle Item ID 引用和同步本地素材",
    nodes: [{
        type: "eagle:item",
        title: "Eagle 资源",
        icon: "🦅",
        description: "从 Eagle Agent 加载图片资源",
        defaultSize: { width: 320, height: 240 },
        defaultMetadata: { eagleStatus: "idle", eagleItemId: "" },
        hidePanel: false,
        autoOpenPanel: true,
        useBuiltinPanel: { mode: "image", writeBackToSelf: false },
        keepAspectRatio: (node) => !node.metadata?.freeResize,
        resource: (node) => {
            const itemId = metadata(node).eagleItemId;
            return itemId ? { kind: "image", url: agentRequestUrl(node, `/items/${encodeURIComponent(itemId)}/file`) } : null;
        },
        Content: EagleContent,
        Panel: EaglePanel,
        toolbar: (ctx) => [
            { id: "eagle-open", title: "在 Eagle 中打开", label: "打开 Eagle", icon: "🦅", onClick: () => openEagle(ctx) },
            { id: "eagle-configure", title: "配置 Eagle Item", label: "配置", icon: "⚙️", onClick: () => ctx.openPanel() },
        ],
    }],
});
