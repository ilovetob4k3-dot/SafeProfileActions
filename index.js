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
    var alerts = ui.alerts || {};
    var storageApi = vendetta.storage || {};
    var logger = vendetta.logger || (typeof console !== "undefined" ? console : {
        log: function () {},
        warn: function () {},
        error: function () {},
    });

    var React = common.React || null;
    var ReactNative = common.ReactNative || {};
    var View = ReactNative.View || null;
    var ScrollView = ReactNative.ScrollView || null;
    var Clipboard = ReactNative.Clipboard || null;

    var findByProps = typeof metro.findByProps === "function" ? metro.findByProps : null;
    var instead = typeof patcher.instead === "function" ? patcher.instead : null;
    var storage = pluginApi.storage || {};
    var useProxy = typeof storageApi.useProxy === "function" ? storageApi.useProxy : null;
    var getAssetIDByName = typeof assets.getAssetIDByName === "function" ? assets.getAssetIDByName : null;
    var showToast = typeof toasts.showToast === "function" ? toasts.showToast : null;
    var showConfirmationAlert = typeof alerts.showConfirmationAlert === "function" ? alerts.showConfirmationAlert : null;

    var PLUGIN_NAME = "SafeProfileActions";
    var TOAST_ICON = "ic_message";
    var patches = [];
    var patchedIds = {};

    var DEFAULTS = {
        blockAddFriend: true,
        confirmAddFriend: false,
        blockCancelFriendRequest: false,
        confirmCancelFriendRequest: true,
        traceMode: true,
        debugToasts: true,
    };

    var diagnostics = {
        pluginLoaded: "no",
        friendActionPatched: "no",
        friendActionPatchCount: 0,
        friendActionFired: "no",
        friendActionFunction: "none",
        friendActionArgCount: "none",
        friendActionArgTypes: "none",
        relationshipModuleFound: "no",
        relationshipModulePropKeys: "none",
        argObjectKeysOnly: "none",
        callStack: "none",
        blockedCount: 0,
        confirmedCount: 0,
        allowedCount: 0,
        lastError: "none",
    };

    function isObject(value) {
        return typeof value === "object" && value !== null;
    }

    function getSetting(key) {
        return storage[key] == null ? DEFAULTS[key] : storage[key];
    }

    function setDefaultSettings() {
        var keys = Object.keys(DEFAULTS);
        var i;
        for (i = 0; i < keys.length; i++) {
            if (storage[keys[i]] == null) storage[keys[i]] = DEFAULTS[keys[i]];
        }
    }

    function log(method, message, metadata) {
        try {
            if (!logger || typeof logger[method] !== "function") return;
            if (metadata === undefined) logger[method]("[" + PLUGIN_NAME + "] " + message);
            else logger[method]("[" + PLUGIN_NAME + "] " + message, metadata);
        } catch (error) {}
    }

    function toast(message, force) {
        if (!force && !getSetting("debugToasts")) return;
        if (!showToast) return;
        try {
            showToast(message, getAssetIDByName ? getAssetIDByName(TOAST_ICON) : void 0);
        } catch (error) {}
    }

    function typeOf(value) {
        if (value === null) return "null";
        if (Array.isArray(value)) return "array";
        return typeof value;
    }

    function argTypes(args) {
        var out = [];
        var i;
        for (i = 0; i < args.length; i++) out.push(typeOf(args[i]));
        return out.join(", ") || "none";
    }

    function argKeysOnly(args) {
        var i;
        for (i = 0; i < args.length; i++) {
            if (isObject(args[i]) && !Array.isArray(args[i])) {
                return "arg[" + i + "] keys: " + JSON.stringify(Object.keys(args[i]).slice(0, 25));
            }
        }
        return "none";
    }

    function sanitizeStack(stack) {
        if (typeof stack !== "string") return "none";
        return stack
            .split("\n")
            .slice(1, 13)
            .map(function (line) {
                return line
                    .replace(/https?:\/\/[^\s)]+/g, "url-redacted")
                    .replace(/\b\d{15,}\b/g, "id-redacted")
                    .trim();
            })
            .filter(Boolean)
            .join("\n");
    }

    function safeOriginalCall(original, args) {
        if (typeof original !== "function") return void 0;
        return original.apply(null, args);
    }

    function actionLabel(functionName) {
        if (functionName === "removeRelationship") return "Cancel Friend Request";
        return "Add Friend";
    }

    function shouldBlock(functionName) {
        if (functionName === "removeRelationship") return Boolean(getSetting("blockCancelFriendRequest"));
        return Boolean(getSetting("blockAddFriend"));
    }

    function shouldConfirm(functionName) {
        if (functionName === "removeRelationship") return Boolean(getSetting("confirmCancelFriendRequest"));
        return Boolean(getSetting("confirmAddFriend"));
    }

    function handleRelationshipAction(args, original, functionName) {
        var label = actionLabel(functionName);
        diagnostics.friendActionFired = "yes";
        diagnostics.friendActionFunction = functionName;
        diagnostics.friendActionArgCount = String(args.length);
        diagnostics.friendActionArgTypes = argTypes(args);
        diagnostics.argObjectKeysOnly = argKeysOnly(args);
        try {
            diagnostics.callStack = sanitizeStack(new Error().stack);
        } catch (error) {
            diagnostics.callStack = "unavailable";
        }

        log("log", label + " action fired.", {
            functionName: functionName,
            argCount: args.length,
            argTypes: diagnostics.friendActionArgTypes,
            argKeysOnly: diagnostics.argObjectKeysOnly,
        });

        if (shouldBlock(functionName)) {
            diagnostics.blockedCount += 1;
            toast("Blocked " + label, true);
            return void 0;
        }

        if (shouldConfirm(functionName)) {
            diagnostics.confirmedCount += 1;
            if (showConfirmationAlert) {
                try {
                    showConfirmationAlert({
                        title: label + "?",
                        content: "Are you sure? SafeProfileActions intercepted this action before Discord sent it.",
                        confirmText: "Continue",
                        cancelText: "Cancel",
                        onConfirm: function () {
                            try {
                                safeOriginalCall(original, args);
                            } catch (error) {
                                diagnostics.lastError = String(error);
                                log("error", "Confirmed action failed.", { error: String(error) });
                            }
                        },
                    });
                    return void 0;
                } catch (error) {
                    diagnostics.lastError = String(error);
                    toast("Confirmation unavailable; blocked " + label, true);
                    return void 0;
                }
            }

            toast("Confirmation unavailable; blocked " + label, true);
            return void 0;
        }

        diagnostics.allowedCount += 1;
        return safeOriginalCall(original, args);
    }

    function getMetroModuleRegistry() {
        var globalAny = typeof globalThis !== "undefined" ? globalThis : {};
        var candidates = [];
        var i;

        try {
            if (globalAny.__r && typeof globalAny.__r.getModules === "function") {
                candidates.push(globalAny.__r.getModules());
            }
        } catch (error) {}

        candidates.push(globalAny.modules);
        candidates.push(globalAny.vendetta && globalAny.vendetta.metro ? globalAny.vendetta.metro.modules : null);
        candidates.push(globalAny.vendetta && globalAny.vendetta.metro ? globalAny.vendetta.metro.metroModules : null);
        candidates.push(globalAny.__vendetta_loader ? globalAny.__vendetta_loader.modules : null);

        for (i = 0; i < candidates.length; i++) {
            if (isObject(candidates[i]) || Array.isArray(candidates[i])) return candidates[i];
        }

        return null;
    }

    function getModuleExports(record) {
        return (
            (record && record.publicModule ? record.publicModule.exports : null) ||
            (record && record.module ? record.module.exports : null) ||
            (record ? record.exports : null) ||
            null
        );
    }

    function targetFunctionName(key, value) {
        var name = typeof value === "function" && typeof value.name === "string" ? value.name : "";
        if (key === "addRelationship" || name === "addRelationship") return "addRelationship";
        if (key === "removeRelationship" || name === "removeRelationship") return "removeRelationship";
        return null;
    }

    function patchAction(owner, key, value, moduleId) {
        var functionName;
        var patchId;

        if (!owner || !key || typeof value !== "function" || !instead) return;

        functionName = targetFunctionName(key, value);
        if (!functionName) return;

        patchId = moduleId + ":" + key + ":" + functionName;
        if (patchedIds[patchId]) return;
        patchedIds[patchId] = true;

        diagnostics.relationshipModuleFound = "yes";
        try {
            diagnostics.relationshipModulePropKeys = Object.keys(owner).slice(0, 30).join(", ") || "none";
        } catch (error) {
            diagnostics.relationshipModulePropKeys = "unavailable";
        }

        patches.push(
            instead(key, owner, function (args, original) {
                return handleRelationshipAction(args || [], original, functionName);
            })
        );

        diagnostics.friendActionPatched = "yes";
        diagnostics.friendActionPatchCount += 1;
        log("log", "Patched relationship action.", { functionName: functionName, key: key, moduleId: moduleId });
    }

    function scanExportsForActions(exportsObject, moduleId, publicModule) {
        var keys;
        var i;

        if (typeof exportsObject === "function" && publicModule) {
            patchAction(publicModule, "exports", exportsObject, moduleId);
        }

        if (!isObject(exportsObject)) return;

        keys = Object.keys(exportsObject);
        for (i = 0; i < keys.length; i++) {
            try {
                patchAction(exportsObject, keys[i], exportsObject[keys[i]], moduleId);
            } catch (error) {}
        }

        if (isObject(exportsObject.default)) {
            keys = Object.keys(exportsObject.default);
            for (i = 0; i < keys.length; i++) {
                try {
                    patchAction(exportsObject.default, keys[i], exportsObject.default[keys[i]], moduleId + ":default");
                } catch (error2) {}
            }
        }
    }

    function patchRelationshipActions() {
        var registry;
        var entries;
        var i;
        var direct;
        var directKeys;

        if (!instead) {
            diagnostics.lastError = "patcher.instead unavailable";
            return;
        }

        if (findByProps) {
            try {
                direct = findByProps("addRelationship");
                if (isObject(direct)) {
                    directKeys = Object.keys(direct);
                    for (i = 0; i < directKeys.length; i++) patchAction(direct, directKeys[i], direct[directKeys[i]], "findByProps:addRelationship");
                }
            } catch (error) {}

            try {
                direct = findByProps("removeRelationship");
                if (isObject(direct)) {
                    directKeys = Object.keys(direct);
                    for (i = 0; i < directKeys.length; i++) patchAction(direct, directKeys[i], direct[directKeys[i]], "findByProps:removeRelationship");
                }
            } catch (error2) {}
        }

        registry = getMetroModuleRegistry();
        if (!registry) return;

        entries = Object.entries(registry);
        for (i = 0; i < entries.length; i++) {
            try {
                var record = entries[i][1];
                scanExportsForActions(getModuleExports(record), "metro:" + entries[i][0], record && record.publicModule);
            } catch (error3) {}
        }
    }

    function buildDiagnosticReport() {
        return [
            "SafeProfileActions Stable Diagnostic Report",
            "plugin loaded: " + diagnostics.pluginLoaded,
            "relationship action patched: " + diagnostics.friendActionPatched,
            "relationship action patch count: " + diagnostics.friendActionPatchCount,
            "relationship action fired: " + diagnostics.friendActionFired,
            "relationship action function: " + diagnostics.friendActionFunction,
            "relationship action arg count: " + diagnostics.friendActionArgCount,
            "relationship action arg types: " + diagnostics.friendActionArgTypes,
            "relationship module found: " + diagnostics.relationshipModuleFound,
            "relationship module prop keys: " + diagnostics.relationshipModulePropKeys,
            "arg object keys only: " + diagnostics.argObjectKeysOnly,
            "blocked count: " + diagnostics.blockedCount,
            "confirmed count: " + diagnostics.confirmedCount,
            "allowed count: " + diagnostics.allowedCount,
            "last error: " + diagnostics.lastError,
            "call stack, sanitized:",
            diagnostics.callStack,
        ].join("\n");
    }

    function copyText(text) {
        try {
            if (Clipboard && typeof Clipboard.setString === "function") {
                Clipboard.setString(text);
                return true;
            }
        } catch (error) {}

        try {
            if (vendetta.native && vendetta.native.clipboard && typeof vendetta.native.clipboard.setString === "function") {
                vendetta.native.clipboard.setString(text);
                return true;
            }
        } catch (error2) {}

        return false;
    }

    function copyDiagnosticReport() {
        var report = buildDiagnosticReport();
        log("log", "Diagnostic report.", { report: report });
        if (copyText(report)) toast("Copied diagnostic report", true);
        else toast("Report logged; clipboard unavailable", true);
    }

    function makeSwitch(label, key, note) {
        if (!Forms.FormSwitchRow) return null;
        return React.createElement(Forms.FormSwitchRow, {
            label: label,
            value: Boolean(getSetting(key)),
            note: note,
            onValueChange: function (value) {
                storage[key] = value;
            },
        });
    }

    function makeRow(label, subLabel, onPress) {
        if (!Forms.FormRow) return null;
        return React.createElement(Forms.FormRow, {
            label: label,
            subLabel: subLabel,
            onPress: onPress,
        });
    }

    function Settings() {
        if (!React || !ScrollView || !View || !Forms.FormSwitchRow) return null;
        if (useProxy) useProxy(storage);

        return React.createElement(
            ScrollView,
            null,
            React.createElement(View, null, [
                makeSwitch("Block Add Friend", "blockAddFriend", "Stops addRelationship before Discord sends the friend request."),
                makeSwitch("Confirm Add Friend", "confirmAddFriend", "Shows a confirmation prompt instead of sending immediately. Block Add Friend takes priority."),
                makeSwitch("Block Cancel Friend Request", "blockCancelFriendRequest", "Stops canceling an outgoing friend request."),
                makeSwitch("Confirm Cancel Friend Request", "confirmCancelFriendRequest", "Prompts before canceling an outgoing request."),
                makeSwitch("Trace Mode", "traceMode", "Keeps sanitized diagnostics for the relationship action path."),
                makeSwitch("Debug Toasts", "debugToasts", "Shows small local toasts when actions are patched or blocked."),
                makeRow("Copy Diagnostic Report", "Copies/logs sanitized patch status and last action metadata.", copyDiagnosticReport),
            ].filter(Boolean))
        );
    }

    return {
        onLoad: function () {
            try {
                diagnostics.pluginLoaded = "yes";
                setDefaultSettings();
                patches = [];
                patchedIds = {};
                patchRelationshipActions();
                toast("SafeProfileActions loaded", true);
                log("log", "Plugin loaded.", {
                    relationshipActionPatched: diagnostics.friendActionPatched,
                    patchCount: diagnostics.friendActionPatchCount,
                });
            } catch (error) {
                diagnostics.lastError = String(error);
                log("error", "Load failed, but error was contained.", { error: String(error) });
                toast("SafeProfileActions load error contained", true);
            }
        },

        onUnload: function () {
            var i;
            for (i = 0; i < patches.length; i++) {
                try {
                    if (typeof patches[i] === "function") patches[i]();
                } catch (error) {}
            }
            patches = [];
            patchedIds = {};
        },

        settings: Settings,
    };
})(
    typeof vendetta !== "undefined"
        ? vendetta
        : typeof globalThis !== "undefined" && globalThis.vendetta
          ? globalThis.vendetta
          : {}
);
