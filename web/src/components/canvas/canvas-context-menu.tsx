import { useEffect } from "react";
import type { ReactNode } from "react";
import { BetweenHorizontalStart, Check, GalleryHorizontal, GalleryHorizontalEnd, Grid2x2, Group, Plus, Trash2, Ungroup } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";
import type { VideoFramePosition } from "@/lib/canvas/canvas-video-frame";

export function CanvasNodeContextMenu({
    menu,
    canCaptureVideoFrame,
    canGroup,
    canUngroup,
    canCloneTemplate,
    alignMode,
    snapMode,
    onClose,
    onCaptureVideoFrame,
    onDuplicate,
    onCloneTemplate,
    onGroup,
    onUngroup,
    onToggleAlignMode,
    onToggleSnapMode,
    onDelete,
}: {
    menu: ContextMenuState;
    canCaptureVideoFrame: boolean;
    canGroup?: boolean;
    canUngroup?: boolean;
    canCloneTemplate?: boolean;
    alignMode: boolean;
    snapMode: boolean;
    onClose: () => void;
    onCaptureVideoFrame: (position: VideoFramePosition) => void;
    onDuplicate: () => void;
    onCloneTemplate?: () => void;
    onGroup?: () => void;
    onUngroup?: () => void;
    onToggleAlignMode: () => void;
    onToggleSnapMode: () => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    const modeItems = (
        <>
            <MenuButton icon={<AlignModeIcon />} label={t("canvas.contextMenu.alignMode")} checked={alignMode} onClick={onToggleAlignMode} />
            <MenuButton icon={<Grid2x2 className="size-4" />} label={t("canvas.contextMenu.snapMode")} checked={snapMode} onClick={onToggleSnapMode} />
        </>
    );

    return (
        <div
            className="fixed z-[80] min-w-48 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "canvas" ? (
                modeItems
            ) : (
                <>
                    {canCaptureVideoFrame ? (
                        <>
                            <MenuButton icon={<BetweenHorizontalStart className="size-4" />} label={t("canvas.videoFrames.first")} onClick={() => onCaptureVideoFrame("first")} />
                            <MenuButton icon={<GalleryHorizontalEnd className="size-4" />} label={t("canvas.videoFrames.last")} onClick={() => onCaptureVideoFrame("last")} />
                            <MenuButton icon={<GalleryHorizontal className="size-4" />} label={t("canvas.videoFrames.current")} onClick={() => onCaptureVideoFrame("current")} />
                            <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
                        </>
                    ) : null}
                    {menu.type === "node" && canGroup ? <MenuButton icon={<Group className="size-4" />} label={t("canvas.nodeToolbar.group")} onClick={onGroup} /> : null}
                    {menu.type === "node" && canUngroup ? <MenuButton icon={<Ungroup className="size-4" />} label={t("canvas.nodeToolbar.ungroup")} onClick={onUngroup} /> : null}
                    {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label={t("canvas.controls.duplicate")} onClick={onDuplicate} /> : null}
                    {menu.type === "node" && canCloneTemplate ? <MenuButton icon={<CloneTemplateIcon />} label={t("canvas.controls.cloneTemplate")} onClick={onCloneTemplate} /> : null}
                    {menu.type === "node" ? (
                        <>
                            <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
                            {modeItems}
                            <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
                        </>
                    ) : null}
                    <MenuButton icon={<Trash2 className="size-4" />} label={t("canvas.controls.delete")} onClick={onDelete} danger />
                </>
            )}
        </div>
    );
}

function MenuButton({ icon, label, checked, onClick, danger = false }: { icon: ReactNode; label: string; checked?: boolean; onClick?: () => void; danger?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: danger ? "#f87171" : theme.node.text }}
            onClick={onClick}
        >
            <span className="flex items-center gap-2">
                {icon}
                <span>{label}</span>
            </span>
            {checked ? <Check className="size-3.5 shrink-0" /> : null}
        </button>
    );
}

export function CloneTemplateIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
            <rect x="2.5" y="2.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" opacity="0.5" />
            <rect x="6" y="6" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.2 1.5" />
        </svg>
    );
}

function AlignModeIcon() {
    return (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
            <path d="M8 1.5v13" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.5" />
            <rect x="2.5" y="3.5" width="4" height="3.5" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
            <rect x="9.5" y="9" width="4" height="3.5" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
        </svg>
    );
}
