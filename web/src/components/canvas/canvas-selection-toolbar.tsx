import type { ReactNode } from "react";
import { Group, Ungroup } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import type { SelectionLayoutAction } from "@/lib/canvas/canvas-node-layout";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const SELECTION_PAD = 14;

export function CanvasSelectionToolbar({
    nodes,
    viewport,
    showToolbar,
    canGroup,
    canUngroup,
    canDistribute,
    onGroup,
    onUngroup,
    onLayout,
}: {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    showToolbar: boolean;
    canGroup: boolean;
    canUngroup: boolean;
    canDistribute: boolean;
    onGroup: () => void;
    onUngroup: () => void;
    onLayout: (action: SelectionLayoutAction) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (nodes.length < 2) return null;

    const bounds = nodeBounds(nodes);
    const left = viewport.x + bounds.left * viewport.k - SELECTION_PAD;
    const top = viewport.y + bounds.top * viewport.k - SELECTION_PAD;
    const width = (bounds.right - bounds.left) * viewport.k + SELECTION_PAD * 2;
    const height = (bounds.bottom - bounds.top) * viewport.k + SELECTION_PAD * 2;

    return (
        <>
            <svg className="pointer-events-none absolute z-[65] overflow-visible" style={{ left, top, width, height }}>
                <rect
                    x={1}
                    y={1}
                    width={Math.max(width - 2, 0)}
                    height={Math.max(height - 2, 0)}
                    rx={16}
                    ry={16}
                    fill={theme.canvas.selectionFill}
                    stroke={theme.canvas.selectionStroke}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                />
            </svg>
            {showToolbar ? (
                <div
                    className="absolute z-[70] flex h-11 -translate-x-1/2 -translate-y-full items-center gap-0.5 overflow-visible rounded-[16px] border px-1.5 text-[14px] shadow-[0_8px_28px_rgba(15,23,42,.16)] backdrop-blur"
                    style={{ left: left + width / 2, top: top - 8, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <SelectionIconButton title={t("canvas.selectionToolbar.alignLeft")} icon={<AlignLeftIcon />} onClick={() => onLayout("align-left")} />
                    <SelectionIconButton title={t("canvas.selectionToolbar.alignCenterX")} icon={<AlignCenterXIcon />} onClick={() => onLayout("align-center-x")} />
                    <SelectionIconButton title={t("canvas.selectionToolbar.alignRight")} icon={<AlignRightIcon />} onClick={() => onLayout("align-right")} />
                    <ToolbarDivider borderColor={theme.toolbar.border} />
                    <SelectionIconButton title={t("canvas.selectionToolbar.alignTop")} icon={<AlignTopIcon />} onClick={() => onLayout("align-top")} />
                    <SelectionIconButton title={t("canvas.selectionToolbar.alignCenterY")} icon={<AlignCenterYIcon />} onClick={() => onLayout("align-center-y")} />
                    <SelectionIconButton title={t("canvas.selectionToolbar.alignBottom")} icon={<AlignBottomIcon />} onClick={() => onLayout("align-bottom")} />
                    <ToolbarDivider borderColor={theme.toolbar.border} />
                    <SelectionIconButton title={t("canvas.selectionToolbar.distributeX")} icon={<DistributeXIcon />} disabled={!canDistribute} onClick={() => onLayout("distribute-x")} />
                    <SelectionIconButton title={t("canvas.selectionToolbar.distributeY")} icon={<DistributeYIcon />} disabled={!canDistribute} onClick={() => onLayout("distribute-y")} />
                    {canGroup || canUngroup ? <ToolbarDivider borderColor={theme.toolbar.border} /> : null}
                    {canGroup ? <SelectionAction title={t("canvas.nodeToolbar.groupTitle")} label={t("canvas.nodeToolbar.group")} icon={<Group className="size-4" />} onClick={onGroup} /> : null}
                    {canUngroup ? <SelectionAction title={t("canvas.nodeToolbar.ungroupTitle")} label={t("canvas.nodeToolbar.ungroup")} icon={<Ungroup className="size-4" />} onClick={onUngroup} /> : null}
                </div>
            ) : null}
        </>
    );
}

function ToolbarDivider({ borderColor }: { borderColor: string }) {
    return <div className="mx-1 h-5 w-px shrink-0" style={{ background: borderColor }} />;
}

function SelectionIconButton({ title, icon, disabled = false, onClick }: { title: string; icon: ReactNode; disabled?: boolean; onClick: () => void }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2}>
            <button
                type="button"
                disabled={disabled}
                className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/10"
                onClick={onClick}
                aria-label={title}
            >
                {icon}
            </button>
        </Tooltip>
    );
}

function SelectionAction({ title, label, icon, onClick }: { title: string; label: string; icon: ReactNode; onClick: () => void }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2}>
            <button type="button" className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10" onClick={onClick} aria-label={title}>
                {icon}
                <span>{label}</span>
            </button>
        </Tooltip>
    );
}

function AlignLeftIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
            <path d="M2.5 2v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="4.5" y="4" width="9" height="3" rx="0.8" fill="currentColor" />
            <rect x="4.5" y="9" width="6" height="3" rx="0.8" fill="currentColor" opacity="0.7" />
        </svg>
    );
}

function AlignCenterXIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
            <path d="M8 2v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="3" y="4" width="10" height="3" rx="0.8" fill="currentColor" />
            <rect x="4.5" y="9" width="7" height="3" rx="0.8" fill="currentColor" opacity="0.7" />
        </svg>
    );
}

function AlignRightIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
            <path d="M13.5 2v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="2.5" y="4" width="9" height="3" rx="0.8" fill="currentColor" />
            <rect x="5.5" y="9" width="6" height="3" rx="0.8" fill="currentColor" opacity="0.7" />
        </svg>
    );
}

function AlignTopIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
            <path d="M2 2.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="4" y="4.5" width="3" height="9" rx="0.8" fill="currentColor" />
            <rect x="9" y="4.5" width="3" height="6" rx="0.8" fill="currentColor" opacity="0.7" />
        </svg>
    );
}

function AlignCenterYIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
            <path d="M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="4" y="3" width="3" height="10" rx="0.8" fill="currentColor" />
            <rect x="9" y="4.5" width="3" height="7" rx="0.8" fill="currentColor" opacity="0.7" />
        </svg>
    );
}

function AlignBottomIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
            <path d="M2 13.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="4" y="2.5" width="3" height="9" rx="0.8" fill="currentColor" />
            <rect x="9" y="5.5" width="3" height="6" rx="0.8" fill="currentColor" opacity="0.7" />
        </svg>
    );
}

function DistributeXIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
            <path d="M2 2.5v11M14 2.5v11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <rect x="4.2" y="4.5" width="2.6" height="7" rx="0.7" fill="currentColor" />
            <rect x="9.2" y="4.5" width="2.6" height="7" rx="0.7" fill="currentColor" />
        </svg>
    );
}

function DistributeYIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
            <path d="M2.5 2h11M2.5 14h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <rect x="4.5" y="4.2" width="7" height="2.6" rx="0.7" fill="currentColor" />
            <rect x="4.5" y="9.2" width="7" height="2.6" rx="0.7" fill="currentColor" />
        </svg>
    );
}
