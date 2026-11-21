import { definePlugin, getRuntime, useEffect, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps, CanvasNodeContext, CanvasNodeData, CanvasNodePanelProps, CanvasPluginSettingsProps } from "@infinite-canvas/plugin-sdk";

const DEFAULT_AGENT_URL = "http://127.0.0.1:23211";
const AGENT_URL_KEY = "infinite-canvas:eagle-agent-url";
const AGENT_TOKEN_KEY = "infinite-canvas:eagle-agent-token";
const EAGLE_API_TOKEN_KEY = "infinite-canvas:eagle-api-token";

type EagleMetadata = {
    eagleItemId?: string;
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

function agentUrl() {
    const configured = window.localStorage.getItem(AGENT_URL_KEY) || DEFAULT_AGENT_URL;
    return configured.replace(/\/$/, "");
}

function agentToken() {
    return window.localStorage.getItem(AGENT_TOKEN_KEY) || "";
}

function agentRequestUrl(path: string) {
    const url = new URL(`${agentUrl()}${path}`);
    const token = agentToken();
    const apiToken = window.localStorage.getItem(EAGLE_API_TOKEN_KEY) || "";
    if (token) url.searchParams.set("token", token);
    if (apiToken.trim()) url.searchParams.set("eagleApiToken", apiToken.trim());
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

async function readItem(itemId: string) {
    const response = await fetch(agentRequestUrl(`/items/${encodeURIComponent(itemId)}`));
    const body = (await response.json().catch(() => null)) as { item?: { name?: string; width?: number; height?: number; tags?: string[]; annotation?: string; url?: string }; error?: string } | null;
    if (!response.ok || !body?.item) throw new Error(body?.error || "Eagle Agent 未返回 Item");
    return body.item;
}

function stop(e: { stopPropagation: () => void }) {
    e.stopPropagation();
}

function EagleSettings({ theme }: CanvasPluginSettingsProps) {
    const [url, setUrl] = useState(agentUrl);
    const [token, setToken] = useState(agentToken);
    const [apiToken, setApiToken] = useState(() => window.localStorage.getItem(EAGLE_API_TOKEN_KEY) || "");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const inputStyle = { background: "transparent", border: `1px solid ${theme.node.stroke}`, borderRadius: 6, color: "inherit", padding: "7px 8px", width: "100%" };

    const save = async () => {
        setBusy(true);
        setMessage("");
        setError("");
        try {
            const base = url.trim().replace(/\/$/, "") || DEFAULT_AGENT_URL;
            const requestUrl = new URL(`${base}/health`);
            if (!["http:", "https:"].includes(requestUrl.protocol)) throw new Error("请输入 HTTP 或 HTTPS 格式的 Agent 地址");
            const headers = new Headers();
            if (token.trim()) headers.set("x-eagle-agent-token", token.trim());
            if (apiToken.trim()) headers.set("x-eagle-api-token", apiToken.trim());
            const response = await fetch(requestUrl, { headers });
            const body = await response.json() as { ok?: boolean; error?: string };
            if (!response.ok || !body.ok) throw new Error(body.error || "无法连接 Eagle Agent");
            window.localStorage.setItem(AGENT_URL_KEY, base);
            window.localStorage.setItem(AGENT_TOKEN_KEY, token.trim());
            window.localStorage.setItem(EAGLE_API_TOKEN_KEY, apiToken.trim());
            getRuntime().emit("eagle:connection-changed");
            setUrl(base);
            setMessage("连接成功，设置已保存并应用到当前浏览器的所有 Eagle 节点和图片同步。");
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{ display: "grid", gap: 14, color: theme.node.text, fontSize: 13 }}>
            <p style={{ margin: 0, color: theme.node.muted }}>配置一次后，当前浏览器站点内的所有画布共用这些连接设置。</p>
            <label style={{ display: "grid", gap: 5 }}>Eagle Agent 地址<input disabled={busy} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_AGENT_URL} style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 5 }}>Agent Token（可选）<input disabled={busy} value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 5 }}>Eagle API Token<input disabled={busy} value={apiToken} onChange={(e) => setApiToken(e.target.value)} type="password" autoComplete="off" placeholder="Eagle 偏好设置 → 开发者选项" style={inputStyle} /></label>
            <span style={{ color: theme.node.muted }}>Eagle API Token 留空时使用 Agent 容器的默认配置。设置保存在当前浏览器中。</span>
            {message ? <span role="status">{message}</span> : null}
            {error ? <span role="alert">{error}</span> : null}
            <button type="button" disabled={busy} onClick={() => void save()} className="rounded bg-transparent px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10" style={{ justifySelf: "start", border: 0, color: "inherit", cursor: busy ? "wait" : "pointer" }}>{busy ? "检查连接中…" : "保存并检查连接"}</button>
        </div>
    );
}

function EagleContent({ ctx }: CanvasNodeContentProps) {
    const info = metadata(ctx.node);
    const itemId = info.eagleItemId || "";
    const [status, setStatus] = useState(info.eagleStatus || (itemId ? "loading" : "idle"));
    const [error, setError] = useState(info.eagleError || "");
    const imageUrl = itemId ? agentRequestUrl(`/items/${encodeURIComponent(itemId)}/file`) : "";

    useEffect(() => {
        let active = true;
        if (!itemId) {
            setStatus("idle");
            return () => {
                active = false;
            };
        }
        setStatus("loading");
        fetch(agentRequestUrl("/health"))
            .then(async (response) => {
                if (!response.ok) throw new Error("Eagle Agent 未启动");
                const item = await readItem(itemId);
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
    }, [itemId, imageUrl]);

    if (!itemId) return <div style={{ color: ctx.theme.node.muted, fontSize: 13, padding: 16 }}>打开面板粘贴 Eagle Item 链接</div>;
    if (status === "error") return <div data-canvas-no-zoom style={{ color: ctx.theme.node.text, display: "grid", gap: 8, padding: 16, fontSize: 13 }}><strong>Eagle 资源暂时不可用</strong><span style={{ color: ctx.theme.node.muted }}>{error || "请确认 Eagle 和 Eagle Agent 已启动"}</span><button type="button" onMouseDown={stop} onClick={() => ctx.openPanel()} style={{ border: 0, background: "transparent", color: ctx.theme.node.text, cursor: "pointer", textAlign: "left", padding: 0 }}>打开配置</button></div>;
    return <div data-canvas-no-zoom style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", overflow: "hidden" }}><img src={imageUrl} alt={ctx.node.title} draggable={false} onError={() => { setStatus("error"); setError("原图读取失败"); }} style={{ width: "100%", height: "100%", objectFit: "contain", opacity: status === "loading" ? 0.45 : 1 }} /></div>;
}

function EaglePanel({ ctx, onClose }: CanvasNodePanelProps) {
    const info = metadata(ctx.node);
    const [link, setLink] = useState(info.eagleItemId ? `http://localhost:41595/item?id=${info.eagleItemId}` : "");
    const [annotation, setAnnotation] = useState(info.eagleAnnotation || "");
    const [tags, setTags] = useState((info.eagleTags || []).join(", "));
    const [sourceUrl, setSourceUrl] = useState(info.eagleSourceUrl || "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [loadedId, setLoadedId] = useState("");
    const [original, setOriginal] = useState<{ annotation: string; tags: string; url: string } | null>(null);

    const load = async (itemId: string) => {
        const item = await readItem(itemId);
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
        readItem(info.eagleItemId).then((item) => {
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
        try {
            if (loadedId !== itemId || !original) {
                await load(itemId);
                return;
            }
            const response = await fetch(agentRequestUrl(`/items/${encodeURIComponent(itemId)}`));
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
            const update = Object.keys(changes).length ? await fetch(agentRequestUrl(`/items/${encodeURIComponent(itemId)}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) }) : null;
            const updateBody = (await update?.json().catch(() => null)) as { error?: string } | null;
            if (update && !update.ok) throw new Error(updateBody?.error || "Eagle Item 信息同步失败");
            ctx.updateNode({ type: "image", title: body.item.name || ctx.node.title, width: body.item.width || ctx.node.width, height: body.item.height || ctx.node.height });
            ctx.updateMetadata({ content: agentRequestUrl(`/items/${encodeURIComponent(itemId)}/file`), storageKey: undefined, eagleItemId: itemId, eagleStatus: "ready", eagleError: undefined, eagleThumbnailUrl: agentRequestUrl(`/items/${encodeURIComponent(itemId)}/thumbnail`), eagleTags: nextTags, eagleAnnotation: nextAnnotation, eagleSourceUrl: nextUrl, naturalWidth: body.item.width, naturalHeight: body.item.height });
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    const inputStyle = { background: "transparent", border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 6, color: "inherit", padding: "7px 8px" };
    const editable = !busy && loadedId === parseItemId(link) && Boolean(loadedId);

    return (
        <div data-canvas-no-zoom onMouseDown={stop} style={{ display: "grid", gap: 10, padding: 14, background: ctx.theme.node.panel, border: `1px solid ${ctx.theme.node.stroke}`, borderRadius: 12, color: ctx.theme.node.text, fontSize: 13 }}>
            <span style={{ color: ctx.theme.node.muted }}>连接参数统一在「节点插件 → Eagle 资源 → 设置」中配置。</span>
            <label style={{ display: "grid", gap: 5 }}>Eagle Item 链接<input disabled={busy} value={link} onChange={(e) => setLink(e.target.value)} placeholder="http://localhost:41595/item?id=..." style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 5 }}>描述<textarea rows={4} disabled={!editable} value={annotation} onChange={(e) => setAnnotation(e.target.value)} placeholder="同步到 Eagle 的描述" style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 5 }}>标签<input disabled={!editable} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="标签1, 标签2" style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 5 }}>来源 URL（留空则写入当前画布节点链接）<input disabled={!editable} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." style={inputStyle} /></label>
            {error ? <span role="alert">{error}</span> : null}
            <button type="button" disabled={busy} onClick={() => void save()} className="rounded bg-transparent px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10" style={{ border: 0, color: "inherit", cursor: busy ? "wait" : "pointer" }}>{busy ? "处理中…" : editable ? "保存并连接" : "读取 Eagle 信息"}</button>
        </div>
    );
}

function openEagle(ctx: CanvasNodeContext) {
    const itemId = metadata(ctx.node).eagleItemId;
    if (itemId) window.open(`http://localhost:41595/item?id=${encodeURIComponent(itemId)}`, "_blank");
}

export default definePlugin({
    id: "eagle",
    name: "Eagle 资源",
    version: "0.1.4",
    description: "以 Eagle Item ID 引用和同步本地素材",
    Settings: EagleSettings,
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
            return itemId ? { kind: "image", url: agentRequestUrl(`/items/${encodeURIComponent(itemId)}/file`) } : null;
        },
        Content: EagleContent,
        Panel: EaglePanel,
        toolbar: (ctx) => [
            { id: "eagle-open", title: "在 Eagle 中打开", label: "打开 Eagle", icon: "🦅", onClick: () => openEagle(ctx) },
            { id: "eagle-configure", title: "配置 Eagle Item", label: "配置", icon: "⚙️", onClick: () => ctx.openPanel() },
        ],
    }],
});
