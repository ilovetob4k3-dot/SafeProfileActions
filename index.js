(function (vendetta) {
    "use strict";

    vendetta = vendetta || {};

    var metro = vendetta.metro || {};
    var common = metro.common || {};
    var patcher = vendetta.patcher || {};
    var pluginApi = vendetta.plugin || {};
    var ui = vendetta.ui || {};
    var components = ui.components || {};
    var Forms = components.Forms || {};
    var assets = ui.assets || {};
    var toasts = ui.toasts || {};
    var storageApi = vendetta.storage || {};

    var find = typeof metro.find === "function" ? metro.find : null;
    var findByName = typeof metro.findByName === "function" ? metro.findByName : null;
    var findByProps = typeof metro.findByProps === "function" ? metro.findByProps : null;
    var after = typeof patcher.after === "function" ? patcher.after : null;
    var instead = typeof patcher.instead === "function" ? patcher.instead : null;
    var storage = pluginApi.storage || {};
    var React = common.React || null;
    var ReactNative = common.ReactNative || {};
    var Alert = ReactNative.Alert || common.Alert || null;
    var ScrollView = ReactNative.ScrollView || null;
    var View = ReactNative.View || null;
    var FormSection = Forms.FormSection || null;
    var FormSwitchRow = Forms.FormSwitchRow || null;
    var getAssetIDByName = typeof assets.getAssetIDByName === "function" ? assets.getAssetIDByName : null;
    var showToast = typeof toasts.showToast === "function" ? toasts.showToast : null;
    var useProxy = typeof storageApi.useProxy === "function" ? storageApi.useProxy : null;

    var DEFAULT_SETTINGS = {
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

    var REACT_PROMPT_1 = {
        title: "React?",
        body: "Are you sure you want to react to this message?",
        confirmText: "React",
        cancelText: "Cancel",
    };

    var REACT_PROMPT_2 = {
        title: "Are you really sure?",
        body: "This will add your reaction.",
        confirmText: "Yes, react",
        cancelText: "Cancel",
    };

    var unpatches = [];
    var reactionBypass = false;

    function initSettings() {
        if (storage.blockAddFriends == null) {
            storage.blockAddFriends = DEFAULT_SETTINGS.blockAddFriends;
        }

        if (storage.showBlockToast == null) {
            storage.showBlockToast = DEFAULT_SETTINGS.showBlockToast;
        }

        if (storage.confirmReact == null) {
            storage.confirmReact =
                storage.doubleConfirmReactions ?? storage.confirmReactions ?? DEFAULT_SETTINGS.confirmReact;
        }

        if (storage.showEmojiInPrompt == null) {
            storage.showEmojiInPrompt = DEFAULT_SETTINGS.showEmojiInPrompt;
        }

        if (storage.noTyping == null) {
            storage.noTyping = DEFAULT_SETTINGS.noTyping;
        }

        if (storage.upHideVoiceButton == null) {
            storage.upHideVoiceButton = DEFAULT_SETTINGS.upHideVoiceButton;
        }

        if (storage.upHideVideoButton == null) {
            storage.upHideVideoButton = DEFAULT_SETTINGS.upHideVideoButton;
        }

        if (storage.dmHideCallButton == null) {
            storage.dmHideCallButton = DEFAULT_SETTINGS.dmHideCallButton;
        }

        if (storage.dmHideVideoButton == null) {
            storage.dmHideVideoButton = DEFAULT_SETTINGS.dmHideVideoButton;
        }

        if (storage.hideVCVideoButton == null) {
            storage.hideVCVideoButton = DEFAULT_SETTINGS.hideVCVideoButton;
        }
    }

    function safeUnpatchAll() {
        unpatches.forEach(function (unpatch) {
            try {
                unpatch();
            } catch {}
        });

        unpatches = [];
        reactionBypass = false;
    }

    function safeToast(message) {
        if (!showToast) return;

        try {
            showToast(message, getAssetIDByName ? getAssetIDByName("ic_message") : void 0);
        } catch {}
    }

    function resolveRelationshipManager() {
        var relationshipManager = findByProps ? findByProps("addRelationship") : null;

        if (
            relationshipManager &&
            typeof relationshipManager === "object" &&
            typeof relationshipManager.addRelationship === "function"
        ) {
            return relationshipManager;
        }

        return null;
    }

    function resolveReactionManager() {
        var reactionManager = findByProps ? findByProps("addReaction") : null;

        if (
            reactionManager &&
            typeof reactionManager === "object" &&
            typeof reactionManager.addReaction === "function"
        ) {
            return reactionManager;
        }

        return null;
    }

    function resolveTypingManager() {
        var typingManager = findByProps ? findByProps("startTyping") : null;

        if (typingManager && typeof typingManager === "object" && typeof typingManager.startTyping === "function") {
            return typingManager;
        }

        return null;
    }

    function shouldBlockAddFriend(args) {
        var payload = Array.isArray(args) ? args[0] : null;
        return Boolean(payload && typeof payload === "object" && payload.type !== 2);
    }

    function sanitizeEmojiName(emoji) {
        var rawName = emoji && typeof emoji === "object" && typeof emoji.name === "string" ? emoji.name : "";
        var sanitized = String(rawName).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);

        return sanitized || null;
    }

    function getReactionPromptBody(defaultBody, args) {
        var emojiName;

        if (!storage.showEmojiInPrompt) {
            return defaultBody;
        }

        emojiName = sanitizeEmojiName(Array.isArray(args) ? args[2] : null);
        return emojiName || defaultBody;
    }

    function showConfirmationPrompt(options) {
        if (!Alert || typeof Alert.alert !== "function") {
            return Promise.resolve(false);
        }

        return new Promise(function (resolve) {
            var settled = false;

            function settle(value) {
                if (settled) return;
                settled = true;
                resolve(value);
            }

            try {
                Alert.alert(
                    options.title,
                    options.body,
                    [
                        {
                            text: options.cancelText,
                            style: "cancel",
                            onPress: function () {
                                settle(false);
                            },
                        },
                        {
                            text: options.confirmText,
                            onPress: function () {
                                settle(true);
                            },
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

    function callOriginalAddReaction(context, orig, args) {
        var result;

        if (typeof orig !== "function") {
            return Promise.resolve(null);
        }

        reactionBypass = true;

        try {
            result = orig.apply(context, args);

            if (result && typeof result.finally === "function") {
                return result.finally(function () {
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

    async function confirmAndAddReaction(context, orig, args) {
        var firstConfirmed;
        var secondConfirmed;

        firstConfirmed = await showConfirmationPrompt({
            title: REACT_PROMPT_1.title,
            body: getReactionPromptBody(REACT_PROMPT_1.body, args),
            confirmText: REACT_PROMPT_1.confirmText,
            cancelText: REACT_PROMPT_1.cancelText,
        });

        if (!firstConfirmed) {
            return;
        }

        secondConfirmed = await showConfirmationPrompt({
            title: REACT_PROMPT_2.title,
            body: getReactionPromptBody(REACT_PROMPT_2.body, args),
            confirmText: REACT_PROMPT_2.confirmText,
            cancelText: REACT_PROMPT_2.cancelText,
        });

        if (!secondConfirmed) {
            return;
        }

        callOriginalAddReaction(context, orig, args);
    }

    function patchAddFriendBlocker() {
        var relationshipManager = resolveRelationshipManager();
        var unpatch;

        if (!relationshipManager || !instead) {
            return;
        }

        unpatch = instead("addRelationship", relationshipManager, function (args, orig) {
            var normalizedArgs = Array.isArray(args) ? args : [];

            if (!storage.blockAddFriends || !shouldBlockAddFriend(normalizedArgs)) {
                return typeof orig === "function" ? orig.apply(relationshipManager, normalizedArgs) : void 0;
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
        var reactionManager = resolveReactionManager();
        var unpatch;

        if (!reactionManager || !instead) {
            return;
        }

        unpatch = instead("addReaction", reactionManager, function (args, orig) {
            var normalizedArgs = Array.isArray(args) ? args : [];

            if (reactionBypass || !storage.confirmReact) {
                return typeof orig === "function" ? orig.apply(reactionManager, normalizedArgs) : void 0;
            }

            void confirmAndAddReaction(reactionManager, orig, normalizedArgs);
            return Promise.resolve(null);
        });

        if (typeof unpatch === "function") {
            unpatches.push(unpatch);
        }
    }

    function patchTypingManager() {
        var typingManager = resolveTypingManager();

        function patchTypingMethod(methodName) {
            var unpatch;

            if (!typingManager || !instead || typeof typingManager[methodName] !== "function") {
                return;
            }

            unpatch = instead(methodName, typingManager, function (args, orig) {
                var normalizedArgs = Array.isArray(args) ? args : [];

                if (!storage.noTyping) {
                    return typeof orig === "function" ? orig.apply(typingManager, normalizedArgs) : void 0;
                }

                return void 0;
            });

            if (typeof unpatch === "function") {
                unpatches.push(unpatch);
            }
        }

        if (!typingManager) {
            return;
        }

        patchTypingMethod("startTyping");
        patchTypingMethod("stopTyping");
    }

    function patchHideCallButtons() {
        var videoCallAsset = getAssetIDByName ? getAssetIDByName("ic_video") : void 0;
        var voiceCallAsset = getAssetIDByName ? getAssetIDByName("ic_audio") : void 0;
        var dmVideoAsset = getAssetIDByName ? getAssetIDByName("video") : void 0;
        var dmCallAsset = getAssetIDByName ? getAssetIDByName("nav_header_connect") : void 0;
        var dmVideoAssetFallback = getAssetIDByName ? getAssetIDByName("VideoIcon") : void 0;
        var dmCallAssetFallback = getAssetIDByName ? getAssetIDByName("PhoneCallIcon") : void 0;
        var userProfileActions = findByName ? findByName("UserProfileActions", false) : null;
        var simplifiedUserProfileContactButtons =
            (findByName ? findByName("SimplifiedUserProfileContactButtons", false) : null) ||
            (findByName ? findByName("UserProfileContactButtons", false) : null);
        var privateChannelButtons = find ? find(function (module) {
            return module && module.type && module.type.name === "PrivateChannelButtons";
        }) : null;
        var channelButtons = findByProps ? findByProps("ChannelButtons") : null;
        var videoButton = findByName ? findByName("VideoButton", false) : null;
        var unpatch;

        if (videoCallAsset == null) {
            videoCallAsset = dmVideoAssetFallback;
        }

        if (voiceCallAsset == null) {
            voiceCallAsset = dmCallAssetFallback;
        }

        if (userProfileActions && typeof userProfileActions.default === "function" && after) {
            unpatch = after("default", userProfileActions, function (_, component) {
                var buttons;
                var idx;

                if (!storage.upHideVoiceButton && !storage.upHideVideoButton) {
                    return;
                }

                buttons = component && component.props && component.props.children && component.props.children.props
                    ? component.props.children.props.children && component.props.children.props.children[1]
                        ? component.props.children.props.children[1].props && component.props.children.props.children[1].props.children
                        : void 0
                    : void 0;

                if (buttons === void 0) {
                    buttons = component && component.props && component.props.children && component.props.children[1]
                        ? component.props.children[1].props && component.props.children[1].props.children
                        : void 0;
                }

                if (buttons && buttons.props && buttons.props.children !== void 0) {
                    buttons = buttons.props.children;
                }

                if (buttons === void 0) {
                    return;
                }

                for (idx in buttons) {
                    var button = buttons[idx];

                    if (button && button.props && button.props.children !== void 0) {
                        var buttonContainer = button.props.children;
                        var innerIdx;

                        for (innerIdx in buttonContainer) {
                            var nestedButton = buttonContainer[innerIdx];

                            if (
                                (nestedButton && nestedButton.props && nestedButton.props.icon === voiceCallAsset && storage.upHideVoiceButton) ||
                                (nestedButton && nestedButton.props && nestedButton.props.icon === videoCallAsset && storage.upHideVideoButton)
                            ) {
                                delete buttonContainer[innerIdx];
                            }
                        }
                    }

                    if (button && button.props && button.props.IconComponent !== void 0) {
                        if (storage.upHideVoiceButton) delete buttons[1];
                        if (storage.upHideVideoButton) delete buttons[2];
                    }

                    if (
                        (button && button.props && button.props.icon === voiceCallAsset && storage.upHideVoiceButton) ||
                        (button && button.props && button.props.icon === videoCallAsset && storage.upHideVideoButton)
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
            unpatch = after("default", simplifiedUserProfileContactButtons, function (_, component) {
                var buttons = component && component.props ? component.props.children : void 0;

                if (buttons === void 0) {
                    return;
                }

                if (storage.upHideVoiceButton) delete buttons[1];
                if (storage.upHideVideoButton) delete buttons[2];
            });

            if (typeof unpatch === "function") {
                unpatches.push(unpatch);
            }
        }

        if (videoButton && typeof videoButton.default === "function" && instead) {
            unpatch = instead("default", videoButton, function (args, orig) {
                var normalizedArgs = Array.isArray(args) ? args : [];

                if (storage.hideVCVideoButton) {
                    return void 0;
                }

                return typeof orig === "function" ? orig.apply(videoButton, normalizedArgs) : void 0;
            });

            if (typeof unpatch === "function") {
                unpatches.push(unpatch);
            }
        }

        if (privateChannelButtons && typeof privateChannelButtons.type === "function" && after) {
            unpatch = after("type", privateChannelButtons, function (_, component) {
                var buttons;
                var idx;

                if (!storage.dmHideCallButton && !storage.dmHideVideoButton) {
                    return;
                }

                buttons = component && component.props ? component.props.children : void 0;

                if (buttons === void 0) {
                    return;
                }

                if (buttons[0] && buttons[0].props && buttons[0].props.accessibilityLabel !== void 0) {
                    if (storage.dmHideCallButton) delete buttons[0];
                    if (storage.dmHideVideoButton) delete buttons[1];
                    return;
                }

                if (buttons[0] && buttons[0].props && buttons[0].props.source === void 0) {
                    buttons = buttons[0].props ? buttons[0].props.children : void 0;
                }

                if (buttons === void 0) {
                    return;
                }

                for (idx in buttons) {
                    var button = buttons[idx];

                    if (
                        (button && button.props && button.props.source === dmCallAsset && storage.dmHideCallButton) ||
                        (button && button.props && button.props.source === dmVideoAsset && storage.dmHideVideoButton) ||
                        (button && button.props && button.props.source === dmCallAssetFallback && storage.dmHideCallButton) ||
                        (button && button.props && button.props.source === dmVideoAssetFallback && storage.dmHideVideoButton)
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
            unpatch = after("ChannelButtons", channelButtons, function (_, component) {
                var buttons = component && component.props ? component.props.children : void 0;
                var idx;

                if (!storage.dmHideCallButton && !storage.dmHideVideoButton) {
                    return;
                }

                if (buttons === void 0) {
                    return;
                }

                for (idx in buttons) {
                    var button = buttons[idx] && buttons[idx].props && buttons[idx].props.children
                        ? buttons[idx].props.children[0]
                        : void 0;

                    if (button === void 0) {
                        continue;
                    }

                    if (
                        (button.props && button.props.source === dmCallAsset && storage.dmHideCallButton) ||
                        (button.props && button.props.source === dmVideoAsset && storage.dmHideVideoButton)
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

    function renderSwitchRow(label, key, fallbackValue, note) {
        if (!FormSwitchRow) {
            return null;
        }

        return React.createElement(FormSwitchRow, {
            label: label,
            value: storage[key] == null ? fallbackValue : Boolean(storage[key]),
            onValueChange: function (value) {
                storage[key] = Boolean(value);
            },
            note: note,
        });
    }

    function renderSection(title, rows) {
        if (!React) {
            return null;
        }

        if (FormSection) {
            return React.createElement(FormSection, { title: title }, rows);
        }

        return React.createElement(View, null, rows);
    }

    function Settings() {
        if (!React || !ScrollView || !View) {
            return null;
        }

        if (typeof useProxy === "function") {
            useProxy(storage);
        }

        return React.createElement(
            ScrollView,
            null,
            React.createElement(
                View,
                null,
                renderSection("Add Friend", [
                    renderSwitchRow(
                        "Block Add Friends",
                        "blockAddFriends",
                        DEFAULT_SETTINGS.blockAddFriends,
                    ),
                    renderSwitchRow(
                        "Show Add Friend Block Toast",
                        "showBlockToast",
                        DEFAULT_SETTINGS.showBlockToast,
                        'Shows "oops lol" when Add Friend is blocked.',
                    ),
                ]),
                renderSection("Calls / User Profile", [
                    renderSwitchRow(
                        "Hide profile voice call button",
                        "upHideVoiceButton",
                        DEFAULT_SETTINGS.upHideVoiceButton,
                    ),
                    renderSwitchRow(
                        "Hide profile video call button",
                        "upHideVideoButton",
                        DEFAULT_SETTINGS.upHideVideoButton,
                    ),
                ]),
                renderSection("Calls / DMs", [
                    renderSwitchRow(
                        "Hide DM voice call button",
                        "dmHideCallButton",
                        DEFAULT_SETTINGS.dmHideCallButton,
                    ),
                    renderSwitchRow(
                        "Hide DM video call button",
                        "dmHideVideoButton",
                        DEFAULT_SETTINGS.dmHideVideoButton,
                    ),
                ]),
                renderSection("Calls / Voice Chat", [
                    renderSwitchRow(
                        "Hide VC video button",
                        "hideVCVideoButton",
                        DEFAULT_SETTINGS.hideVCVideoButton,
                    ),
                ]),
                renderSection("Typing", [
                    renderSwitchRow(
                        "Hide Typing Indicator",
                        "noTyping",
                        DEFAULT_SETTINGS.noTyping,
                    ),
                ]),
                renderSection("Reactions", [
                    renderSwitchRow(
                        "Confirm React",
                        "confirmReact",
                        DEFAULT_SETTINGS.confirmReact,
                    ),
                    renderSwitchRow(
                        "Show Emoji In Prompt",
                        "showEmojiInPrompt",
                        DEFAULT_SETTINGS.showEmojiInPrompt,
                    ),
                ]),
            ),
        );
    }

    return {
        onLoad: function () {
            try {
                initSettings();
                safeUnpatchAll();
                patchAddFriendBlocker();
                patchReactionConfirmation();
                patchTypingManager();
                patchHideCallButtons();
            } catch {}
        },
        onUnload: function () {
            safeUnpatchAll();
        },
        settings: Settings,
    };
})(vendetta);
