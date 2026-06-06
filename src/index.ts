import { ReactNative } from "@vendetta/metro/common";
import { find, findByName, findByProps } from "@vendetta/metro";
import { after, instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";
import Settings from "./settings";

const DEFAULT_SETTINGS = {
    blockAddFriends: true,
    showBlockToast: false,
    confirmReact: true,
    showEmojiInPrompt: false,
    noTyping: false,
    upHideVoiceButton: true,
    upHideVideoButton: true,
    dmHideCallButton: false,
    dmHideVideoButton: false,
    hideVCVideoButton: false,
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
    storage.blockAddFriends ??= DEFAULT_SETTINGS.blockAddFriends;
    storage.showBlockToast ??= DEFAULT_SETTINGS.showBlockToast;
    storage.confirmReact ??= storage.doubleConfirmReactions ?? storage.confirmReactions ?? DEFAULT_SETTINGS.confirmReact;
    storage.showEmojiInPrompt ??= DEFAULT_SETTINGS.showEmojiInPrompt;
    storage.noTyping ??= DEFAULT_SETTINGS.noTyping;
    storage.upHideVoiceButton ??= DEFAULT_SETTINGS.upHideVoiceButton;
    storage.upHideVideoButton ??= DEFAULT_SETTINGS.upHideVideoButton;
    storage.dmHideCallButton ??= DEFAULT_SETTINGS.dmHideCallButton;
    storage.dmHideVideoButton ??= DEFAULT_SETTINGS.dmHideVideoButton;
    storage.hideVCVideoButton ??= DEFAULT_SETTINGS.hideVCVideoButton;
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

function resolveTypingManager() {
    const typingManager = findByProps("startTyping");
    return typeof typingManager?.startTyping === "function" ? typingManager : null;
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

    const secondConfirmed = await showConfirmationPrompt({
        title: REACT_PROMPT_2.title,
        body: getReactionPromptBody(REACT_PROMPT_2.body, args),
        confirmText: REACT_PROMPT_2.confirmText,
        cancelText: REACT_PROMPT_2.cancelText,
    });

    if (!secondConfirmed) return;

    callOriginalAddReaction(context, orig, args);
}

function patchAddFriendBlocker() {
    const relationshipManager = resolveRelationshipManager();
    if (!relationshipManager || !instead) return;

    const unpatch = instead("addRelationship", relationshipManager, (args, orig) => {
        const normalizedArgs = Array.isArray(args) ? args : [];

        if (!storage.blockAddFriends || !shouldBlockAddFriend(normalizedArgs)) {
            return typeof orig === "function" ? orig.apply(relationshipManager, normalizedArgs) : undefined;
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
    if (!reactionManager || !instead) return;

    const unpatch = instead("addReaction", reactionManager, (args, orig) => {
        const normalizedArgs = Array.isArray(args) ? args : [];

        if (reactionBypass || !storage.confirmReact) {
            return typeof orig === "function" ? orig.apply(reactionManager, normalizedArgs) : undefined;
        }

        void confirmAndAddReaction(reactionManager, orig, normalizedArgs);
        return Promise.resolve(null);
    });

    if (typeof unpatch === "function") {
        unpatches.push(unpatch);
    }
}

function patchTypingManager() {
    const typingManager = resolveTypingManager();
    if (!typingManager || !instead) return;

    const patchTypingMethod = (methodName: "startTyping" | "stopTyping") => {
        if (typeof typingManager[methodName] !== "function") return;

        const unpatch = instead(methodName, typingManager, (args, orig) => {
            const normalizedArgs = Array.isArray(args) ? args : [];

            if (!storage.noTyping) {
                return typeof orig === "function" ? orig.apply(typingManager, normalizedArgs) : undefined;
            }

            return undefined;
        });

        if (typeof unpatch === "function") {
            unpatches.push(unpatch);
        }
    };

    patchTypingMethod("startTyping");
    patchTypingMethod("stopTyping");
}

function patchHideCallButtons() {
    const videoCallAsset = getAssetIDByName("ic_video") ?? getAssetIDByName("VideoIcon");
    const voiceCallAsset = getAssetIDByName("ic_audio") ?? getAssetIDByName("PhoneCallIcon");
    const dmVideoAsset = getAssetIDByName("video");
    const dmCallAsset = getAssetIDByName("nav_header_connect");
    const dmVideoAssetFallback = getAssetIDByName("VideoIcon");
    const dmCallAssetFallback = getAssetIDByName("PhoneCallIcon");

    const userProfileActions = findByName("UserProfileActions", false);
    const simplifiedUserProfileContactButtons =
        findByName("SimplifiedUserProfileContactButtons", false) ?? findByName("UserProfileContactButtons", false);
    const privateChannelButtons = find((module) => module?.type?.name === "PrivateChannelButtons");
    const channelButtons = findByProps("ChannelButtons");
    const videoButton = findByName("VideoButton", false);

    if (userProfileActions && typeof userProfileActions.default === "function" && after) {
        const unpatch = after("default", userProfileActions, (_, component) => {
            if (!storage.upHideVoiceButton && !storage.upHideVideoButton) return;

            let buttons = component?.props?.children?.props?.children?.[1]?.props?.children;
            if (buttons === undefined) {
                buttons = component?.props?.children?.[1]?.props?.children;
            }
            if (buttons?.props?.children !== undefined) {
                buttons = buttons.props.children;
            }
            if (buttons === undefined) return;

            for (const idx in buttons) {
                const button = buttons[idx];

                if (button?.props?.children !== undefined) {
                    const buttonContainer = button.props.children;

                    for (const innerIdx in buttonContainer) {
                        const nestedButton = buttonContainer[innerIdx];

                        if (
                            (nestedButton?.props?.icon === voiceCallAsset && storage.upHideVoiceButton) ||
                            (nestedButton?.props?.icon === videoCallAsset && storage.upHideVideoButton)
                        ) {
                            delete buttonContainer[innerIdx];
                        }
                    }
                }

                if (button?.props?.IconComponent !== undefined) {
                    if (storage.upHideVoiceButton) delete buttons[1];
                    if (storage.upHideVideoButton) delete buttons[2];
                }

                if (
                    (button?.props?.icon === voiceCallAsset && storage.upHideVoiceButton) ||
                    (button?.props?.icon === videoCallAsset && storage.upHideVideoButton)
                ) {
                    delete buttons[idx];
                }
            }
        });

        if (typeof unpatch === "function") {
            unpatches.push(unpatch);
        }
    }

    if (simplifiedUserProfileContactButtons && typeof simplifiedUserProfileContactButtons.default === "function" && after) {
        const unpatch = after("default", simplifiedUserProfileContactButtons, (_, component) => {
            const buttons = component?.props?.children;
            if (buttons === undefined) return;

            if (storage.upHideVoiceButton) delete buttons[1];
            if (storage.upHideVideoButton) delete buttons[2];
        });

        if (typeof unpatch === "function") {
            unpatches.push(unpatch);
        }
    }

    if (videoButton && typeof videoButton.default === "function" && instead) {
        const unpatch = instead("default", videoButton, (args, orig) => {
            if (storage.hideVCVideoButton) return undefined;

            return typeof orig === "function" ? orig.apply(videoButton, Array.isArray(args) ? args : []) : undefined;
        });

        if (typeof unpatch === "function") {
            unpatches.push(unpatch);
        }
    }

    if (privateChannelButtons && typeof privateChannelButtons.type === "function" && after) {
        const unpatch = after("type", privateChannelButtons, (_, component) => {
            if (!storage.dmHideCallButton && !storage.dmHideVideoButton) return;

            let buttons = component?.props?.children;
            if (buttons === undefined) return;

            if (buttons[0]?.props?.accessibilityLabel !== undefined) {
                if (storage.dmHideCallButton) delete buttons[0];
                if (storage.dmHideVideoButton) delete buttons[1];
                return;
            }

            if (buttons[0]?.props?.source === undefined) {
                buttons = buttons[0]?.props?.children;
            }
            if (buttons === undefined) return;

            for (const idx in buttons) {
                const button = buttons[idx];

                if (
                    (button?.props?.source === dmCallAsset && storage.dmHideCallButton) ||
                    (button?.props?.source === dmVideoAsset && storage.dmHideVideoButton) ||
                    (button?.props?.source === dmCallAssetFallback && storage.dmHideCallButton) ||
                    (button?.props?.source === dmVideoAssetFallback && storage.dmHideVideoButton)
                ) {
                    delete buttons[idx];
                }
            }
        });

        if (typeof unpatch === "function") {
            unpatches.push(unpatch);
        }
    }

    if (channelButtons && typeof channelButtons.ChannelButtons === "function" && after) {
        const unpatch = after("ChannelButtons", channelButtons, (_, component) => {
            if (!storage.dmHideCallButton && !storage.dmHideVideoButton) return;

            const buttons = component?.props?.children;
            if (buttons === undefined) return;

            for (const idx in buttons) {
                const button = buttons[idx]?.props?.children?.[0];
                if (button === undefined) continue;

                if (
                    (button?.props?.source === dmCallAsset && storage.dmHideCallButton) ||
                    (button?.props?.source === dmVideoAsset && storage.dmHideVideoButton)
                ) {
                    delete buttons[idx];
                }
            }
        });

        if (typeof unpatch === "function") {
            unpatches.push(unpatch);
        }
    }
}

export default {
    onLoad: () => {
        try {
            initSettings();
            safeUnpatchAll();
            patchAddFriendBlocker();
            patchReactionConfirmation();
            patchTypingManager();
            patchHideCallButtons();
        } catch {}
    },

    onUnload: () => {
        safeUnpatchAll();
    },

    settings: Settings,
};
