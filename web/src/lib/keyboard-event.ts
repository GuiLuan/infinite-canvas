type NativeKeyboardEventLike = {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
};

type KeyboardEventLike = NativeKeyboardEventLike & {
    key?: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    repeat?: boolean;
    nativeEvent?: NativeKeyboardEventLike;
};

export function isImeComposing(event: KeyboardEventLike) {
    const nativeEvent = event.nativeEvent;
    return Boolean(event.isComposing || nativeEvent?.isComposing || event.keyCode === 229 || event.which === 229 || nativeEvent?.keyCode === 229 || nativeEvent?.which === 229);
}

export type GenerationShortcut = "mod+enter" | "disabled";

export function isGenerationShortcut(event: KeyboardEventLike, shortcut: GenerationShortcut = "mod+enter") {
    if (shortcut === "disabled" || event.key !== "Enter" || event.shiftKey || event.altKey || event.repeat || isImeComposing(event)) return false;
    const isApplePlatform = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
    return shortcut === "mod+enter" && (isApplePlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}

export function generationShortcutLabel(shortcut: GenerationShortcut = "mod+enter") {
    if (shortcut === "disabled") return "";
    return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "Command + Enter" : "Ctrl + Enter";
}

export function isPlainEnterKey(event: KeyboardEventLike) {
    return event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !isImeComposing(event);
}

