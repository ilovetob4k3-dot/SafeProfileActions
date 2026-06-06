import { ReactNative } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";
import Settings from "./settings";

const DEFAULT_SETTINGS = {
    showBlockToast: false,
    confirmReactions: true,
    doubleConfirmReactions: true,
    showEmojiInPrompt: false,
};

const REACT_PROMPT_1 = {
    title: "React?",
    body: "Are you sure you want to react to this message?",
    confirmText: "React",
    cancelText: "Cancel",
};

const REACT_PROMPT_2 = {
    title: "Are you really sure?",
    body: "This will add your reaction.",
    confirmText: "Yes, react",
    cancelText: "Cancel",
};

let unpatches: Array<() => void> = [];
let reactionBypass = false;

function initSettings() {
    storage.showBlockToast ??= DEFAULT_SETTINGS.showBlockToast;
    storage.confirmReactions ??= DEFAULT_SETTINGS.confirmReactions;
    storage.doubleConfirmReactions ??= DEFAULT_SETTINGS.doubleConfirmReactions;
    storage.showEmojiInPrompt ??= DEFAULT_SETTINGS.showEmojiInPrompt;
}

function safeUnpatchAll() {
    for (const unpatch of unpatches) {
        try {
            unpatch();
        } catch {}
    }

    unpatches = [];
    reactionBypass = false;
}

function safeToast(message: string) {
    try {
        showToast(message, getAssetIDByName("ic_message"));
    } catch {}
}

function resolveRelationshipManager() {
    const relationshipManager = findByProps("addRelationship");
    return typeof relationshipManager?.addRelationship === "function" ? relationshipManager : null;
}

function resolveReactionManager() {
    const reactionManager = findByProps("addReaction");
    return typeof reactionManager?.addReaction === "function" ? reactionManager : null;
}

function shouldBlockAddFriend(args: unknown[]) {
    const payload = Array.isArray(args) ? args[0] : null;
    return Boolean(payload && typeof payload === "object" && (payload as { type?: unknown }).type !== 2);
}

function sanitizeEmojiName(emoji: unknown) {
    const rawName =
        emoji && typeof emoji === "object" && typeof (emoji as { name?: unknown }).name === "string"
            ? (emoji as { name: string }).name
            : "";
    const sanitized = rawName.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);

    return sanitized || null;
}

function getReactionPromptBody(defaultBody: string, args: unknown[]) {
    if (!storage.showEmojiInPrompt) return defaultBody;

    const emojiName = sanitizeEmojiName(Array.isArray(args) ? args[2] : null);
    return emojiName ?? defaultBody;
}

function showConfirmationPrompt(options: {
    title: string;
    body: string;
    confirmText: string;
    cancelText: string;
}) {
    const Alert = ReactNative?.Alert;

    if (!Alert || typeof Alert.alert !== "function") {
        return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (value: boolean) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        try {
            Alert.alert(
                options.title,
                options.body,
                [
                    {
                        text: options.cancelText,
                        style: "cancel",
                        onPress: () => settle(false),
                    },
                    {
                        text: options.confirmText,
                        onPress: () => settle(true),
                    },
                ],
                {
                    cancelable: false,
                },
            );
        } catch {
            settle(false);
        }
    });
}

function callOriginalAddReaction(context: unknown, orig: Function | undefined, args: unknown[]) {
    if (typeof orig !== "function") {
        return Promise.resolve(null);
    }

    reactionBypass = true;

    try {
        const result = orig.apply(context, args);

        if (result && typeof (result as Promise<unknown>).finally === "function") {
            return (result as Promise<unknown>).finally(() => {
                reactionBypass = false;
            });
        }

        reactionBypass = false;
        return result;
    } catch (error) {
        reactionBypass = false;
        throw error;
    }
}

async function confirmAndAddReaction(context: unknown, orig: Function | undefined, args: unknown[]) {
    const firstConfirmed = await showConfirmationPrompt({
        title: REACT_PROMPT_1.title,
        body: getReactionPromptBody(REACT_PROMPT_1.body, args),
        confirmText: REACT_PROMPT_1.confirmText,
        cancelText: REACT_PROMPT_1.cancelText,
    });

    if (!firstConfirmed) return;

    if (storage.doubleConfirmReactions) {
        const secondConfirmed = await showConfirmationPrompt({
            title: REACT_PROMPT_2.title,
            body: getReactionPromptBody(REACT_PROMPT_2.body, args),
            confirmText: REACT_PROMPT_2.confirmText,
            cancelText: REACT_PROMPT_2.cancelText,
        });

        if (!secondConfirmed) return;
    }

    callOriginalAddReaction(context, orig, args);
}

function patchAddFriendBlocker() {
    const relationshipManager = resolveRelationshipManager();
    if (!relationshipManager) return;

    const unpatch = instead("addRelationship", relationshipManager, (args, orig) => {
        const normalizedArgs = Array.isArray(args) ? args : [];

        if (!shouldBlockAddFriend(normalizedArgs)) {
            return typeof orig === "function" ? orig.apply(relationshipManager, args) : undefined;
        }

        if (storage.showBlockToast) {
            safeToast("oops lol");
        }

        return Promise.resolve(null);
    });

    if (typeof unpatch === "function") {
        unpatches.push(unpatch);
    }
}

function patchReactionConfirmation() {
    const reactionManager = resolveReactionManager();
    if (!reactionManager) return;

    const unpatch = instead("addReaction", reactionManager, (args, orig) => {
        const normalizedArgs = Array.isArray(args) ? args : [];

        if (reactionBypass || !storage.confirmReactions) {
            return typeof orig === "function" ? orig.apply(reactionManager, args) : undefined;
        }

        void confirmAndAddReaction(reactionManager, orig, normalizedArgs);
        return Promise.resolve(null);
    });

    if (typeof unpatch === "function") {
        unpatches.push(unpatch);
    }
}

export default {
    onLoad: () => {
        try {
            initSettings();
            safeUnpatchAll();
            patchAddFriendBlocker();
            patchReactionConfirmation();
        } catch {}
    },

    onUnload: () => {
        safeUnpatchAll();
    },

    settings: Settings,
};
