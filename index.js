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

    var findByProps = typeof metro.findByProps === "function" ? metro.findByProps : null;
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
        showBlockToast: false,
        confirmReactions: true,
        doubleConfirmReactions: true,
        showEmojiInPrompt: false,
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
        if (storage.showBlockToast == null) {
            storage.showBlockToast = DEFAULT_SETTINGS.showBlockToast;
        }

        if (storage.confirmReactions == null) {
            storage.confirmReactions = DEFAULT_SETTINGS.confirmReactions;
        }

        if (storage.doubleConfirmReactions == null) {
            storage.doubleConfirmReactions = DEFAULT_SETTINGS.doubleConfirmReactions;
        }

        if (storage.showEmojiInPrompt == null) {
            storage.showEmojiInPrompt = DEFAULT_SETTINGS.showEmojiInPrompt;
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

        if (storage.doubleConfirmReactions) {
            secondConfirmed = await showConfirmationPrompt({
                title: REACT_PROMPT_2.title,
                body: getReactionPromptBody(REACT_PROMPT_2.body, args),
                confirmText: REACT_PROMPT_2.confirmText,
                cancelText: REACT_PROMPT_2.cancelText,
            });

            if (!secondConfirmed) {
                return;
            }
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

            if (!shouldBlockAddFriend(normalizedArgs)) {
                return typeof orig === "function" ? orig.apply(relationshipManager, args) : void 0;
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

            if (reactionBypass || !storage.confirmReactions) {
                return typeof orig === "function" ? orig.apply(reactionManager, args) : void 0;
            }

            void confirmAndAddReaction(reactionManager, orig, normalizedArgs);
            return Promise.resolve(null);
        });

        if (typeof unpatch === "function") {
            unpatches.push(unpatch);
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
                        "Show Add Friend Block Toast",
                        "showBlockToast",
                        DEFAULT_SETTINGS.showBlockToast,
                        'Shows "oops lol" when Add Friend is blocked.',
                    ),
                ]),
                renderSection("Reactions", [
                    renderSwitchRow(
                        "Confirm Reactions",
                        "confirmReactions",
                        DEFAULT_SETTINGS.confirmReactions,
                    ),
                    renderSwitchRow(
                        "Double Confirm Reactions",
                        "doubleConfirmReactions",
                        DEFAULT_SETTINGS.doubleConfirmReactions,
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
            } catch {}
        },
        onUnload: function () {
            safeUnpatchAll();
        },
        settings: Settings,
    };
})(vendetta);
