import express from "express";
import { createReadStream } from "node:fs";
import { access, readdir } from "node:fs/promises";
import path from "node:path";

const app = express();
const port = Number(process.env.PORT || 23211);
const eagleApiBase = String(process.env.EAGLE_API_BASE_URL || "http://127.0.0.1:41595").replace(/\/$/, "");
const agentToken = String(process.env.EAGLE_AGENT_TOKEN || "");
const pathRewriteFrom = String(process.env.EAGLE_PATH_REWRITE_FROM || "");
const pathRewriteTo = String(process.env.EAGLE_PATH_REWRITE_TO || "");
const allowedRoot = String(process.env.EAGLE_LIBRARY_ROOT || "");
const canvasListeners = new Set();

app.use(express.json({ limit: "40mb" }));
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-eagle-agent-token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
    if (agentToken && req.headers["x-eagle-agent-token"] !== agentToken && req.query.token !== agentToken) return res.status(401).json({ ok: false, error: "Eagle Agent token 无效" });
    next();
});

function eagleUrl(endpoint, query = "") {
    return `${eagleApiBase}${endpoint}${query}`;
}

async function eagleRequest(endpoint, init) {
    const response = await fetch(eagleUrl(endpoint), { ...init, headers: { accept: "application/json", ...(init?.headers || {}) } });
    const text = await response.text();
    let body;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = { status: "error", message: text || `Eagle 返回 ${response.status}` };
    }
    if (!response.ok || body?.status === "error") throw new Error(body?.message || `Eagle 请求失败 (${response.status})`);
    return body?.data ?? body;
}

function itemFromResult(data) {
    return Array.isArray(data?.data) ? data.data[0] || null : data;
}

function rewritePath(rawPath) {
    let value = decodeURIComponent(String(rawPath || "")).replaceAll("\\", "/");
    const from = pathRewriteFrom.replaceAll("\\", "/");
    const to = pathRewriteTo.replaceAll("\\", "/");
    if (from && to && value.toLowerCase().startsWith(from.toLowerCase())) value = `${to}${value.slice(from.length)}`;
    const resolved = path.resolve(value);
    const relative = allowedRoot && path.relative(path.resolve(allowedRoot), resolved);
    if (relative && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) throw new Error("Eagle 文件路径不在允许的资源库目录内");
    return resolved;
}

async function thumbnailPath(itemId) {
    const result = await eagleRequest(`/api/item/thumbnail?id=${encodeURIComponent(itemId)}`);
    return rewritePath(result);
}

async function originalPath(itemId) {
    if (!/^[a-z0-9]+$/i.test(itemId)) throw new Error("Eagle Item ID 无效");
    const [result, library] = await Promise.all([
        eagleRequest(`/api/v2/item/get?id=${encodeURIComponent(itemId)}`),
        eagleRequest("/api/v2/library/info"),
    ]);
    const item = itemFromResult(result);
    if (!item?.name || !item?.ext || !library?.path) throw new Error("Eagle Item 或资源库不存在");
    const dir = path.join(rewritePath(library.path), "images", `${itemId}.info`);
    const files = await readdir(dir);
    const exactName = `${item.name}.${item.ext}`;
    const matches = files.filter((name) => name.toLowerCase().endsWith(`.${String(item.ext).toLowerCase()}`) && !name.toLowerCase().endsWith(`_thumbnail.${String(item.ext).toLowerCase()}`));
    const name = files.includes(exactName) ? exactName : matches.length === 1 ? matches[0] : null;
    if (!name) throw new Error("无法确定 Eagle 原图文件");
    return path.join(dir, name);
}

function sourcePayload(body) {
    const source = body?.source || {};
    const value = String(source.value || "");
    const payload = { ...(body.name ? { name: body.name } : {}), ...(Array.isArray(body.tags) ? { tags: body.tags } : {}), ...(Array.isArray(body.folders) ? { folders: body.folders } : {}), ...(body.annotation ? { annotation: body.annotation } : {}) };
    if (source.type === "url") payload.url = value;
    else if (source.type === "base64") payload.base64 = value;
    else if (source.type === "path") payload.path = value;
    else if (source.type === "bookmark") payload.bookmarkURL = value;
    else throw new Error("Eagle 资源来源类型无效");
    return payload;
}

app.get("/health", async (_req, res) => {
    try {
        const info = await eagleRequest("/");
        res.json({ ok: true, eagle: { version: info?.version || null, buildVersion: info?.buildVersion || null }, capabilities: { itemMetadata: true, itemWrite: true, thumbnailStream: true } });
    } catch (error) {
        res.status(503).json({ ok: false, error: error instanceof Error ? error.message : String(error), eagleApiBase });
    }
});

app.get("/canvas/events", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    canvasListeners.add(res);
    req.on("close", () => canvasListeners.delete(res));
});

app.post("/canvas/open", (req, res) => {
    const { projectId, nodeId } = req.body || {};
    if (typeof projectId !== "string" || !projectId || typeof nodeId !== "string" || !nodeId) return res.status(400).json({ ok: false, error: "缺少画布或节点 ID" });
    const event = `data: ${JSON.stringify({ projectId, nodeId })}\n\n`;
    for (const listener of canvasListeners) listener.write(event);
    res.json({ ok: true });
});

app.get("/items/:id", async (req, res) => {
    try {
        const data = await eagleRequest(`/api/v2/item/get?id=${encodeURIComponent(req.params.id)}`);
        const item = itemFromResult(data);
        if (!item) return res.status(404).json({ ok: false, error: "Eagle Item 不存在" });
        res.json({ ok: true, item });
    } catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/items/:id/file", async (req, res) => {
    try {
        const filePath = await originalPath(req.params.id);
        await access(filePath);
        res.type(path.extname(filePath));
        createReadStream(filePath).on("error", (error) => res.destroy(error)).pipe(res);
    } catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/items/:id/thumbnail", async (req, res) => {
    try {
        const filePath = await thumbnailPath(req.params.id);
        await access(filePath);
        res.setHeader("Cache-Control", "private, max-age=60");
        res.type(path.extname(filePath));
        createReadStream(filePath).on("error", (error) => res.destroy(error)).pipe(res);
    } catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});

app.get("/items/:id/link", (req, res) => {
    res.json({ ok: true, url: `${eagleApiBase}/item?id=${encodeURIComponent(req.params.id)}` });
});

app.post("/items", async (req, res) => {
    try {
        const data = await eagleRequest("/api/v2/item/add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sourcePayload(req.body)) });
        const id = data?.id || data?.ids?.[0];
        if (!id) throw new Error("Eagle 没有返回新 Item ID");
        res.json({ ok: true, itemId: id, data });
    } catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});

app.patch("/items/:id", async (req, res) => {
    try {
        const data = await eagleRequest("/api/v2/item/update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: req.params.id, ...req.body }) });
        res.json({ ok: true, item: itemFromResult(data) || data });
    } catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});

app.listen(port, "0.0.0.0", () => console.log(`Eagle Agent listening on http://127.0.0.1:${port}`));
