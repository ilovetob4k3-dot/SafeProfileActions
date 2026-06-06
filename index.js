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
    var getAssetIDByName = typeof assets.getAssetIDByName === "function" ? assets.getAssetIDByName : null;
    var showToast = typeof toasts.showToast === "function" ? toasts.showToast : null;
    var useProxy = typeof storageApi.useProxy === "function" ? storageApi.useProxy : null;

    var React = common.React || null;
    var ReactNative = common.ReactNative || {};
    var ScrollView = ReactNative.ScrollView || null;
    var View = ReactNative.View || null;

    var DEFAULT_SETTINGS = {
        showBlockToast: false,
    };

    var unpatchAddRelationship = null;

    function initSettings() {
        if (storage.showBlockToast == null) {
            storage.showBlockToast = DEFAULT_SETTINGS.showBlockToast;
        }
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

    function shouldAllowOriginal(args) {
        var payload = Array.isArray(args) ? args[0] : null;

        return Boolean(payload && typeof payload === "object" && payload.type === 2);
    }

    function showBlockedToast() {
        if (!storage.showBlockToast || !showToast) return;

        try {
            showToast("oops lol", getAssetIDByName ? getAssetIDByName("ic_message") : void 0);
        } catch {}
    }

    function safeUnpatch() {
        if (typeof unpatchAddRelationship === "function") {
            try {
                unpatchAddRelationship();
            } catch {}
        }

        unpatchAddRelationship = null;
    }

    function Settings() {
        if (!React || !ScrollView || !View || !Forms.FormSwitchRow) return null;
        if (useProxy) useProxy(storage);

        return React.createElement(
            ScrollView,
            null,
            React.createElement(
                View,
                null,
                React.createElement(Forms.FormSwitchRow, {
                    label: "Show block toast",
                    value: storage.showBlockToast == null ? DEFAULT_SETTINGS.showBlockToast : storage.showBlockToast,
                    onValueChange: function (value) {
                        storage.showBlockToast = Boolean(value);
                    },
                    note: 'Shows "oops lol" when Add Friend is blocked.',
                })
            )
        );
    }

    return {
        onLoad: function () {
            try {
                var relationshipManager;

                initSettings();
                safeUnpatch();

                if (!instead) return;

                relationshipManager = resolveRelationshipManager();
                if (!relationshipManager) return;

                unpatchAddRelationship = instead("addRelationship", relationshipManager, function (args, orig) {
                    if (shouldAllowOriginal(args)) {
                        return typeof orig === "function" ? orig.apply(relationshipManager, args) : void 0;
                    }

                    showBlockedToast();
                    return Promise.resolve(null);
                });
            } catch {}
        },

        onUnload: function () {
            safeUnpatch();
        },

        settings: Settings,
    };
})(vendetta);
