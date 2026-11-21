import { Button, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { previewUrlFor, resolveImageUrl } from "@/services/image-storage";
import type { CanvasGenerationSnapshot } from "@/types/canvas";

export function useGenerationDetails() {
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [modal, holder] = Modal.useModal();
    const show = async (snapshot?: CanvasGenerationSnapshot) => {
        const separateSystemPrompt = snapshot && (snapshot.mode === "text" || (snapshot.mode === "image" && snapshot.channel.apiFormat === "gemini" && !snapshot.channel.models[0]?.script))
            ? snapshot.settings.systemPrompt?.trim() : undefined;
        const references = await Promise.all((snapshot?.referenceImages || []).map(async (reference) => ({
            ...reference,
            src: previewUrlFor(reference.storageKey) || await resolveImageUrl(reference.storageKey, reference.dataUrl || reference.url),
        })));
        modal.info({ title: t(snapshot ? "common.details" : "canvas.generation.original"), width: 560, content: snapshot && (
            <div className="space-y-3 text-sm">
                <p>{snapshot.channel.name} / {snapshot.channel.models[0]?.name || snapshot.model}</p>
                <div><strong>{t("canvas.generation.inputPrompt")}</strong><p className="whitespace-pre-wrap break-words">{snapshot.input}</p></div>
                {separateSystemPrompt && <div><strong>{t("config.preferences.systemPrompt")}</strong><p className="whitespace-pre-wrap break-words">{separateSystemPrompt}</p></div>}
                <div><strong>{t("canvas.generation.finalPrompt")}</strong><p className="whitespace-pre-wrap break-words">{snapshot.prompt}</p></div>
                <div><strong>{t("workbench.settings")}</strong><pre className="whitespace-pre-wrap break-words">{JSON.stringify({ ...snapshot.settings, count: snapshot.count }, null, 2)}</pre></div>
                <div className="flex flex-wrap gap-2">
                    {references.map((reference) => <span key={reference.id} className="inline-flex flex-col items-center gap-1">{reference.src && <img src={reference.src} alt={reference.name} className="size-14 rounded object-cover" />}<span>{reference.name}</span></span>)}
                    {[...snapshot.referenceVideos, ...snapshot.referenceAudios].map((reference) => <span key={reference.id}>{reference.name}</span>)}
                </div>
                <Button size="small" onClick={() => copyText([separateSystemPrompt, snapshot.prompt].filter(Boolean).join("\n\n"))}>{t("common.copyPrompt")}</Button>
            </div>
        ) });
    };
    return { holder, show };
}
