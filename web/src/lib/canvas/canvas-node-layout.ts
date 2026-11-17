import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type SelectionLayoutAction =
    | "align-left"
    | "align-center-x"
    | "align-right"
    | "align-top"
    | "align-center-y"
    | "align-bottom"
    | "distribute-x"
    | "distribute-y";

export function getAlignableSelectedNodes(selectedIds: Set<string>, nodes: CanvasNodeData[]) {
    const selectedGroupIds = new Set(nodes.filter((node) => selectedIds.has(node.id) && node.type === CanvasNodeType.Group).map((node) => node.id));
    return nodes.filter((node) => selectedIds.has(node.id) && !(node.metadata?.groupId && selectedGroupIds.has(node.metadata.groupId)));
}

export function applySelectionLayout(selectedIds: Set<string>, nodes: CanvasNodeData[], action: SelectionLayoutAction): CanvasNodeData[] {
    const items = getAlignableSelectedNodes(selectedIds, nodes);
    if (items.length < 2) return nodes;
    if ((action === "distribute-x" || action === "distribute-y") && items.length < 3) return nodes;

    const deltas = new Map<string, { dx: number; dy: number }>();
    const bounds = nodeBounds(items);

    if (action === "align-left") {
        items.forEach((item) => deltas.set(item.id, { dx: bounds.left - item.position.x, dy: 0 }));
    } else if (action === "align-center-x") {
        const centerX = (bounds.left + bounds.right) / 2;
        items.forEach((item) => deltas.set(item.id, { dx: centerX - item.width / 2 - item.position.x, dy: 0 }));
    } else if (action === "align-right") {
        items.forEach((item) => deltas.set(item.id, { dx: bounds.right - item.width - item.position.x, dy: 0 }));
    } else if (action === "align-top") {
        items.forEach((item) => deltas.set(item.id, { dx: 0, dy: bounds.top - item.position.y }));
    } else if (action === "align-center-y") {
        const centerY = (bounds.top + bounds.bottom) / 2;
        items.forEach((item) => deltas.set(item.id, { dx: 0, dy: centerY - item.height / 2 - item.position.y }));
    } else if (action === "align-bottom") {
        items.forEach((item) => deltas.set(item.id, { dx: 0, dy: bounds.bottom - item.height - item.position.y }));
    } else if (action === "distribute-x") {
        const sorted = [...items].sort((a, b) => a.position.x - b.position.x || a.id.localeCompare(b.id));
        const totalWidth = sorted.reduce((sum, item) => sum + item.width, 0);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const gap = (last.position.x + last.width - first.position.x - totalWidth) / (sorted.length - 1);
        let cursor = first.position.x + first.width + gap;
        for (let i = 1; i < sorted.length - 1; i += 1) {
            const item = sorted[i];
            deltas.set(item.id, { dx: cursor - item.position.x, dy: 0 });
            cursor += item.width + gap;
        }
    } else if (action === "distribute-y") {
        const sorted = [...items].sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id));
        const totalHeight = sorted.reduce((sum, item) => sum + item.height, 0);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const gap = (last.position.y + last.height - first.position.y - totalHeight) / (sorted.length - 1);
        let cursor = first.position.y + first.height + gap;
        for (let i = 1; i < sorted.length - 1; i += 1) {
            const item = sorted[i];
            deltas.set(item.id, { dx: 0, dy: cursor - item.position.y });
            cursor += item.height + gap;
        }
    }

    if (!deltas.size) return nodes;

    let changed = false;
    const next = nodes.map((node) => {
        const delta = deltas.get(node.id) ?? (node.metadata?.groupId ? deltas.get(node.metadata.groupId) : undefined);
        if (!delta || (delta.dx === 0 && delta.dy === 0)) return node;
        changed = true;
        return { ...node, position: { x: node.position.x + delta.dx, y: node.position.y + delta.dy } };
    });
    return changed ? next : nodes;
}
