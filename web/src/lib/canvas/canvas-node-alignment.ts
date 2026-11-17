import type { CanvasNodeData, Position } from "@/types/canvas";

export const CANVAS_GRID_SIZE = 48;
const ALIGN_THRESHOLD_PX = 8;
const GUIDE_PADDING = 24;
const MATCH_EPSILON = 0.5;

export type AlignmentGuide = {
    orientation: "vertical" | "horizontal";
    pos: number;
    start: number;
    end: number;
};

export type NodeRectBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type CanvasNodeResizeMeta = {
    corner: ResizeCorner;
    startLeft: number;
    startTop: number;
    startWidth: number;
    startHeight: number;
    rawWidth: number;
    rawHeight: number;
    keepRatio: boolean;
    ratio: number;
    primaryAxis: "x" | "y";
    ctrlKey: boolean;
};

function snapToGrid(value: number, step = CANVAS_GRID_SIZE) {
    return Math.round(value / step) * step;
}

function findClosestAxisMatch(anchors: number[], candidates: { pos: number; node: CanvasNodeData }[], threshold: number) {
    let best: { pos: number; delta: number } | null = null;
    for (const anchor of anchors) {
        for (const candidate of candidates) {
            const delta = candidate.pos - anchor;
            const abs = Math.abs(delta);
            if (abs <= threshold && (!best || abs < Math.abs(best.delta))) {
                best = { pos: candidate.pos, delta };
            }
        }
    }
    return best;
}

function collectAxisTargets(otherNodes: CanvasNodeData[], axis: "x" | "y") {
    const targets: { pos: number; node: CanvasNodeData }[] = [];
    for (const node of otherNodes) {
        if (axis === "x") {
            targets.push({ pos: node.position.x, node }, { pos: node.position.x + node.width / 2, node }, { pos: node.position.x + node.width, node });
        } else {
            targets.push({ pos: node.position.y, node }, { pos: node.position.y + node.height / 2, node }, { pos: node.position.y + node.height, node });
        }
    }
    return targets;
}

function buildGuide(orientation: "vertical" | "horizontal", pos: number, bounds: NodeRectBounds, otherNodes: CanvasNodeData[]): AlignmentGuide {
    const targets = collectAxisTargets(otherNodes, orientation === "vertical" ? "x" : "y").filter((item) => Math.abs(item.pos - pos) <= MATCH_EPSILON);
    if (orientation === "vertical") {
        const start = Math.min(bounds.top, ...targets.map((item) => item.node.position.y)) - GUIDE_PADDING;
        const end = Math.max(bounds.bottom, ...targets.map((item) => item.node.position.y + item.node.height)) + GUIDE_PADDING;
        return { orientation, pos, start, end };
    }
    const start = Math.min(bounds.left, ...targets.map((item) => item.node.position.x)) - GUIDE_PADDING;
    const end = Math.max(bounds.right, ...targets.map((item) => item.node.position.x + item.node.width)) + GUIDE_PADDING;
    return { orientation, pos, start, end };
}

export function resolveDragAlignment({
    rawBounds,
    otherNodes,
    alignEnabled,
    snapEnabled,
    scale,
}: {
    rawBounds: NodeRectBounds;
    otherNodes: CanvasNodeData[];
    alignEnabled: boolean;
    snapEnabled: boolean;
    scale: number;
}): { dxAdjust: number; dyAdjust: number; guides: AlignmentGuide[] } {
    const threshold = ALIGN_THRESHOLD_PX / Math.max(scale, 0.05);
    const xTargets = alignEnabled ? collectAxisTargets(otherNodes, "x") : [];
    const yTargets = alignEnabled ? collectAxisTargets(otherNodes, "y") : [];

    const xMatch = alignEnabled ? findClosestAxisMatch([rawBounds.left, (rawBounds.left + rawBounds.right) / 2, rawBounds.right], xTargets, threshold) : null;
    const yMatch = alignEnabled ? findClosestAxisMatch([rawBounds.top, (rawBounds.top + rawBounds.bottom) / 2, rawBounds.bottom], yTargets, threshold) : null;

    const dxAdjust = xMatch ? xMatch.delta : snapEnabled ? snapToGrid(rawBounds.left) - rawBounds.left : 0;
    const dyAdjust = yMatch ? yMatch.delta : snapEnabled ? snapToGrid(rawBounds.top) - rawBounds.top : 0;

    const finalBounds: NodeRectBounds = {
        left: rawBounds.left + dxAdjust,
        top: rawBounds.top + dyAdjust,
        right: rawBounds.right + dxAdjust,
        bottom: rawBounds.bottom + dyAdjust,
    };

    const guides: AlignmentGuide[] = [];
    if (xMatch) guides.push(buildGuide("vertical", xMatch.pos, finalBounds, otherNodes));
    if (yMatch) guides.push(buildGuide("horizontal", yMatch.pos, finalBounds, otherNodes));
    return { dxAdjust, dyAdjust, guides };
}

export function resolveResizeAlignment({
    meta,
    width,
    height,
    position,
    minWidth = 220,
    minHeight = 160,
    otherNodes,
    alignEnabled,
    snapEnabled,
    scale,
}: {
    meta: CanvasNodeResizeMeta;
    width: number;
    height: number;
    position: Position;
    minWidth?: number;
    minHeight?: number;
    otherNodes: CanvasNodeData[];
    alignEnabled: boolean;
    snapEnabled: boolean;
    scale: number;
}): { width: number; height: number; position: Position; guides: AlignmentGuide[] } {
    if (!alignEnabled && !snapEnabled) {
        return { width, height, position, guides: [] };
    }

    const fromLeft = meta.corner.includes("left");
    const fromTop = meta.corner.includes("top");
    const anchorX = fromLeft ? meta.startLeft + meta.startWidth : meta.startLeft;
    const anchorY = fromTop ? meta.startTop + meta.startHeight : meta.startTop;
    const threshold = ALIGN_THRESHOLD_PX / Math.max(scale, 0.05);
    const xTargets = alignEnabled ? collectAxisTargets(otherNodes, "x") : [];
    const yTargets = alignEnabled ? collectAxisTargets(otherNodes, "y") : [];

    let nextWidth = width;
    let nextHeight = height;
    const rawMovingX = fromLeft ? position.x : position.x + width;
    const rawMovingY = fromTop ? position.y : position.y + height;

    const validXTargets = xTargets.filter((target) => {
        const w = fromLeft ? anchorX - target.pos : target.pos - anchorX;
        if (w < minWidth) return false;
        return !meta.keepRatio || w / meta.ratio >= minHeight;
    });
    const validYTargets = yTargets.filter((target) => {
        const h = fromTop ? anchorY - target.pos : target.pos - anchorY;
        if (h < minHeight) return false;
        return !meta.keepRatio || h * meta.ratio >= minWidth;
    });

    const xMatch = alignEnabled ? findClosestAxisMatch([rawMovingX], validXTargets, threshold) : null;
    const yMatch = alignEnabled ? findClosestAxisMatch([rawMovingY], validYTargets, threshold) : null;

    let snappedXPos: number | null = null;
    let snappedYPos: number | null = null;

    if (meta.keepRatio) {
        const ratio = meta.ratio;
        const chooseX = xMatch && yMatch ? (Math.abs(xMatch.delta) === Math.abs(yMatch.delta) ? meta.primaryAxis === "x" : Math.abs(xMatch.delta) < Math.abs(yMatch.delta)) : Boolean(xMatch);
        if (xMatch && chooseX) {
            nextWidth = fromLeft ? anchorX - xMatch.pos : xMatch.pos - anchorX;
            nextHeight = nextWidth / ratio;
            snappedXPos = xMatch.pos;
        } else if (yMatch) {
            nextHeight = fromTop ? anchorY - yMatch.pos : yMatch.pos - anchorY;
            nextWidth = nextHeight * ratio;
            snappedYPos = yMatch.pos;
        } else if (snapEnabled) {
            if (meta.primaryAxis === "x") {
                const gridX = snapToGrid(rawMovingX);
                const candidateW = fromLeft ? anchorX - gridX : gridX - anchorX;
                const minRatioW = Math.max(minWidth, minHeight * ratio);
                nextWidth = Math.max(minRatioW, candidateW);
                nextHeight = nextWidth / ratio;
            } else {
                const gridY = snapToGrid(rawMovingY);
                const candidateH = fromTop ? anchorY - gridY : gridY - anchorY;
                const minRatioH = Math.max(minHeight, minWidth / ratio);
                nextHeight = Math.max(minRatioH, candidateH);
                nextWidth = nextHeight * ratio;
            }
        }
    } else {
        if (xMatch) {
            nextWidth = fromLeft ? anchorX - xMatch.pos : xMatch.pos - anchorX;
            snappedXPos = xMatch.pos;
        } else if (snapEnabled) {
            const gridX = snapToGrid(rawMovingX);
            nextWidth = Math.max(minWidth, fromLeft ? anchorX - gridX : gridX - anchorX);
        }

        if (yMatch) {
            nextHeight = fromTop ? anchorY - yMatch.pos : yMatch.pos - anchorY;
            snappedYPos = yMatch.pos;
        } else if (snapEnabled) {
            const gridY = snapToGrid(rawMovingY);
            nextHeight = Math.max(minHeight, fromTop ? anchorY - gridY : gridY - anchorY);
        }
    }

    const nextPosition = {
        x: fromLeft ? anchorX - nextWidth : anchorX,
        y: fromTop ? anchorY - nextHeight : anchorY,
    };
    const finalBounds: NodeRectBounds = {
        left: nextPosition.x,
        top: nextPosition.y,
        right: nextPosition.x + nextWidth,
        bottom: nextPosition.y + nextHeight,
    };

    const guides: AlignmentGuide[] = [];
    if (snappedXPos !== null) {
        guides.push(buildGuide("vertical", snappedXPos, finalBounds, otherNodes));
    } else if (alignEnabled && yMatch) {
        const finalMovingX = fromLeft ? finalBounds.left : finalBounds.right;
        const coincidentX = findClosestAxisMatch([finalMovingX], validXTargets, MATCH_EPSILON);
        if (coincidentX) guides.push(buildGuide("vertical", coincidentX.pos, finalBounds, otherNodes));
    }
    if (snappedYPos !== null) {
        guides.push(buildGuide("horizontal", snappedYPos, finalBounds, otherNodes));
    } else if (alignEnabled && xMatch) {
        const finalMovingY = fromTop ? finalBounds.top : finalBounds.bottom;
        const coincidentY = findClosestAxisMatch([finalMovingY], validYTargets, MATCH_EPSILON);
        if (coincidentY) guides.push(buildGuide("horizontal", coincidentY.pos, finalBounds, otherNodes));
    }

    return { width: nextWidth, height: nextHeight, position: nextPosition, guides };
}
