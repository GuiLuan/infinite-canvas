export function serializePromptEditor(editor: HTMLElement, readReference: (element: HTMLElement) => string | undefined) {
    const isBlock = (node: ChildNode | null) => node instanceof HTMLElement && (node.tagName === "DIV" || node.tagName === "P");
    const serialize = (parent: HTMLElement): string => Array.from(parent.childNodes).map((node, index) => {
        const prefix = index > 0 && (isBlock(node) || isBlock(node.previousSibling))
            && !(node.previousSibling instanceof HTMLElement && node.previousSibling.tagName === "BR") ? "\n" : "";
        if (node.nodeType === Node.TEXT_NODE) return prefix + (node.textContent || "");
        if (!(node instanceof HTMLElement)) return "";
        if (node.tagName === "BR") return prefix + (node.nextSibling ? "\n" : "");
        return prefix + (readReference(node) ?? serialize(node));
    }).join("");
    return serialize(editor).replace(/﻿/g, "");
}
