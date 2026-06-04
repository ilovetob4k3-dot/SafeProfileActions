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
    var storageApi = vendetta.storage || {};
    var logger =
        vendetta.logger ||
        (typeof console !== "undefined"
            ? console
            : {
                  log: function () {},
                  error: function () {},
                  warn: function () {},
              });

    var findByName = typeof metro.findByName === "function" ? metro.findByName : null;
    var findByProps = typeof metro.findByProps === "function" ? metro.findByProps : null;
    var after = typeof patcher.after === "function" ? patcher.after : null;
    var storage = pluginApi.storage || {};
    var getAssetIDByName = typeof assets.getAssetIDByName === "function" ? assets.getAssetIDByName : null;
    var useProxy = typeof storageApi.useProxy === "function" ? storageApi.useProxy : null;

    var React = common.React || null;
    var ReactNative = common.ReactNative || {};
    var View = ReactNative.View || null;
    var ScrollView = ReactNative.ScrollView || null;
    var Text = ReactNative.Text || null;

    var PLUGIN_NAME = "SafeProfileActions";
    var DEFAULT_SETTINGS = {
        hideAddFriend: true,
        hideMessage: true,
        hideCall: false,
        debugMode: false,
    };
    var ACTIONS = ["addFriend", "message", "call"];
    var ACTION_LABELS = {
        addFriend: ["add friend", "send friend request"],
        message: ["message", "send message"],
        call: ["call", "voice call", "audio call", "phone call", "start call"],
    };
    var ACTION_ASSET_NAMES = {
        addFriend: [
            "AddFriendIcon",
            "FriendRequestIcon",
            "UserPlusIcon",
            "ic_add_friend",
            "ic_friend_add",
            "ic_person_add",
            "person_add_24px",
        ],
        message: [
            "MessageIcon",
            "ChatIcon",
            "ic_message",
            "ic_message_24px",
            "ic_chat_bubble",
            "ic_chat_bubble_16px",
            "ic_dm_24px",
        ],
        call: [
            "PhoneCallIcon",
            "nav_header_connect",
            "ic_audio",
            "ic_call",
            "ic_call_24px",
            "phone",
        ],
    };

    var reverseAssetLookup = findByProps ? findByProps("getAssetByID") : null;
    var assetIds = {
        addFriend: new Set(),
        message: new Set(),
        call: new Set(),
    };
    var patches = [];

    function log(method, message, metadata) {
        if (!logger || typeof logger[method] !== "function") return;
        if (metadata === undefined) logger[method]("[" + PLUGIN_NAME + "] " + message);
        else logger[method]("[" + PLUGIN_NAME + "] " + message, metadata);
    }

    function isDebugEnabled() {
        return Boolean(storage.debugMode == null ? DEFAULT_SETTINGS.debugMode : storage.debugMode);
    }

    function debugLog(message, metadata) {
        if (!isDebugEnabled()) return;
        log("log", message, metadata);
    }

    function initSettings() {
        if (storage.hideAddFriend == null) storage.hideAddFriend = DEFAULT_SETTINGS.hideAddFriend;
        if (storage.hideMessage == null) storage.hideMessage = DEFAULT_SETTINGS.hideMessage;
        if (storage.hideCall == null) storage.hideCall = DEFAULT_SETTINGS.hideCall;
        if (storage.debugMode == null) storage.debugMode = DEFAULT_SETTINGS.debugMode;
    }

    function initAssetIds() {
        var i;
        var j;

        for (i = 0; i < ACTIONS.length; i++) {
            assetIds[ACTIONS[i]].clear();

            if (!getAssetIDByName) continue;

            for (j = 0; j < ACTION_ASSET_NAMES[ACTIONS[i]].length; j++) {
                var assetId = getAssetIDByName(ACTION_ASSET_NAMES[ACTIONS[i]][j]);
                if (assetId != null) assetIds[ACTIONS[i]].add(assetId);
            }
        }
    }

    function normalizeText(value) {
        return String(value)
            .toLowerCase()
            .replace(/[_-]+/g, " ")
            .replace(/[^a-z0-9 ]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function uniqueStrings(values) {
        var seen = new Set();
        var results = [];
        var i;

        for (i = 0; i < values.length; i++) {
            var normalized = normalizeText(values[i]);
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            results.push(normalized);
        }

        return results;
    }

    function isObject(value) {
        return typeof value === "object" && value !== null;
    }

    function collectStrings(value, results, visited, depth) {
        var i;
        var key;
        var keys;

        if (!visited) visited = new WeakSet();
        if (depth == null) depth = 0;
        if (value == null || depth > 4) return;

        if (typeof value === "string") {
            results.push(value);
            return;
        }

        if (!isObject(value)) return;
        if (visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value)) {
            for (i = 0; i < value.length; i++) {
                collectStrings(value[i], results, visited, depth + 1);
            }
            return;
        }

        keys = ["accessibilityLabel", "label", "text", "title", "children"];
        for (i = 0; i < keys.length; i++) {
            key = keys[i];
            if (value[key] != null) collectStrings(value[key], results, visited, depth + 1);
        }

        if (value.props != null) collectStrings(value.props, results, visited, depth + 1);
    }

    function collectAssetRefs(value, results, visited, depth) {
        var i;
        var key;
        var keys;

        if (!visited) visited = new WeakSet();
        if (depth == null) depth = 0;
        if (value == null || depth > 3) return;
        if (!isObject(value)) return;
        if (visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value)) {
            for (i = 0; i < value.length; i++) {
                collectAssetRefs(value[i], results, visited, depth + 1);
            }
            return;
        }

        keys = ["icon", "source"];
        for (i = 0; i < keys.length; i++) {
            key = keys[i];
            if (value[key] != null) results.push(value[key]);
        }

        if (value.props != null) collectAssetRefs(value.props, results, visited, depth + 1);
        if (value.children != null) collectAssetRefs(value.children, results, visited, depth + 1);
    }

    function resolveAssetName(assetRef) {
        var i;
        var keys;

        if (typeof assetRef === "string") return assetRef;

        if (typeof assetRef === "number") {
            var asset = reverseAssetLookup && reverseAssetLookup.getAssetByID
                ? reverseAssetLookup.getAssetByID(assetRef)
                : null;
            return asset && typeof asset.name === "string" ? asset.name : null;
        }

        if (!isObject(assetRef)) return null;

        keys = ["name", "iconName", "asset", "uri"];
        for (i = 0; i < keys.length; i++) {
            if (typeof assetRef[keys[i]] === "string") return assetRef[keys[i]];
        }

        return null;
    }

    function extractMetadata(node) {
        var strings = [];
        var assetRefs = [];
        var props = node.props || {};

        collectStrings(props, strings);
        collectAssetRefs(props, assetRefs);

        var assetNames = [];
        var i;
        for (i = 0; i < assetRefs.length; i++) {
            var assetName = resolveAssetName(assetRefs[i]);
            if (assetName) assetNames.push(assetName);
        }

        return {
            propKeys: Object.keys(props).sort(),
            accessibilityLabel: typeof props.accessibilityLabel === "string" ? props.accessibilityLabel : null,
            labels: uniqueStrings(strings).slice(0, 6),
            assetNames: uniqueStrings(assetNames).slice(0, 6),
        };
    }

    function matchesNeedle(labels, needles) {
        var i;
        var j;
        for (i = 0; i < labels.length; i++) {
            for (j = 0; j < needles.length; j++) {
                if (labels[i] === needles[j] || labels[i].indexOf(needles[j]) !== -1) {
                    return true;
                }
            }
        }
        return false;
    }

    function matchesKnownProps(node, action) {
        var props = node.props || {};
        var raw = [];
        var keys = ["action", "type", "testID", "analyticsName", "iconName", "name"];
        var i;

        for (i = 0; i < keys.length; i++) {
            if (typeof props[keys[i]] === "string") raw.push(props[keys[i]]);
        }

        return matchesNeedle(uniqueStrings(raw), ACTION_LABELS[action]);
    }

    function matchesAsset(node, action) {
        var refs = [];
        var i;

        collectAssetRefs(node.props || {}, refs);
        for (i = 0; i < refs.length; i++) {
            if (assetIds[action].has(refs[i])) return true;
        }

        return false;
    }

    function getMatchedAction(node) {
        var props = node.props || {};
        var isButtonLike =
            typeof props.onPress === "function" ||
            typeof props.onLongPress === "function" ||
            props.accessibilityRole === "button" ||
            props.role === "button" ||
            props.icon != null ||
            props.source != null ||
            props.IconComponent != null;
        var i;
        var metadata;
        var action;

        if (!isButtonLike) return null;

        metadata = extractMetadata(node);

        for (i = 0; i < ACTIONS.length; i++) {
            action = ACTIONS[i];
            if (matchesNeedle(metadata.labels, ACTION_LABELS[action])) return action;
        }

        for (i = 0; i < ACTIONS.length; i++) {
            action = ACTIONS[i];
            if (matchesKnownProps(node, action)) return action;
        }

        for (i = 0; i < ACTIONS.length; i++) {
            action = ACTIONS[i];
            if (matchesAsset(node, action)) return action;
        }

        return null;
    }

    function shouldHide(action) {
        if (action === "addFriend") {
            return Boolean(storage.hideAddFriend == null ? DEFAULT_SETTINGS.hideAddFriend : storage.hideAddFriend);
        }
        if (action === "message") {
            return Boolean(storage.hideMessage == null ? DEFAULT_SETTINGS.hideMessage : storage.hideMessage);
        }
        return Boolean(storage.hideCall == null ? DEFAULT_SETTINGS.hideCall : storage.hideCall);
    }

    function pruneTree(node, componentName) {
        var i;
        var nextChildren;
        var matchedAction;
        var metadata;

        if (Array.isArray(node)) {
            nextChildren = [];
            for (i = 0; i < node.length; i++) {
                var child = pruneTree(node[i], componentName);
                if (child != null) nextChildren.push(child);
            }
            return nextChildren;
        }

        if (!isObject(node) || !isObject(node.props)) return node;

        matchedAction = getMatchedAction(node);
        if (matchedAction && shouldHide(matchedAction)) {
            metadata = extractMetadata(node);
            debugLog("Removed " + matchedAction + " button from " + componentName + ".", {
                propKeys: metadata.propKeys,
                accessibilityLabel: metadata.accessibilityLabel,
                labels: metadata.labels,
                assetNames: metadata.assetNames,
            });
            return null;
        }

        if (node.props.children != null) {
            node.props.children = pruneTree(node.props.children, componentName);
        }

        return node;
    }

    function patchProfileComponent(module, componentName) {
        if (!module) {
            debugLog("Component not found: " + componentName + ".");
            return;
        }

        if (!after) {
            debugLog("Patcher unavailable; skipping " + componentName + ".");
            return;
        }

        try {
            patches.push(
                after("default", module, function (_, rendered) {
                    try {
                        return pruneTree(rendered, componentName);
                    } catch (error) {
                        debugLog("Failed to traverse " + componentName + ".", {
                            error: String(error),
                        });
                        return rendered;
                    }
                })
            );
        } catch (error) {
            debugLog("Failed to patch " + componentName + ".", {
                error: String(error),
            });
        }
    }

    function loadPatches() {
        var moduleEntries;
        var seen = new Set();
        var i;

        if (!findByName) {
            debugLog("Metro lookup unavailable; profile buttons were not patched.");
            return;
        }

        moduleEntries = [
            { name: "UserProfileActions", module: findByName("UserProfileActions", false) },
            { name: "SimplifiedUserProfileContactButtons", module: findByName("SimplifiedUserProfileContactButtons", false) },
            { name: "UserProfileContactButtons", module: findByName("UserProfileContactButtons", false) },
        ];

        for (i = 0; i < moduleEntries.length; i++) {
            var entry = moduleEntries[i];

            if (!entry.module || seen.has(entry.module)) {
                if (!entry.module) debugLog("Component unavailable on this build: " + entry.name + ".");
                continue;
            }

            seen.add(entry.module);
            patchProfileComponent(entry.module, entry.name);
        }
    }

    function createSwitchRow(key, label, note, fallbackValue) {
        if (!React || !Forms.FormSwitchRow) return null;

        return React.createElement(Forms.FormSwitchRow, {
            key: key,
            label: label,
            note: note,
            value: storage[key] == null ? fallbackValue : storage[key],
            onValueChange: function (value) {
                storage[key] = value;
            },
        });
    }

    function Settings() {
        if (useProxy) useProxy(storage);

        if (!React) return null;

        if (ScrollView && View && Forms.FormSwitchRow) {
            return React.createElement(
                ScrollView,
                null,
                React.createElement(
                    View,
                    null,
                    createSwitchRow(
                        "hideAddFriend",
                        "Hide Add Friend",
                        "Hides the large Add Friend button on user profiles.",
                        DEFAULT_SETTINGS.hideAddFriend
                    ),
                    createSwitchRow(
                        "hideMessage",
                        "Hide Message",
                        "Hides the message button on user profiles.",
                        DEFAULT_SETTINGS.hideMessage
                    ),
                    createSwitchRow(
                        "hideCall",
                        "Hide Call",
                        "Optionally hides the phone/call button on user profiles.",
                        DEFAULT_SETTINGS.hideCall
                    ),
                    createSwitchRow(
                        "debugMode",
                        "Debug mode",
                        "Logs sanitized button metadata only. No user or session data is logged.",
                        DEFAULT_SETTINGS.debugMode
                    )
                )
            );
        }

        if (Text) {
            return React.createElement(
                Text,
                null,
                "Settings UI is unavailable on this client build, but SafeProfileActions is loaded."
            );
        }

        return null;
    }

    return {
        onLoad: function () {
            initSettings();
            initAssetIds();
            loadPatches();
        },
        onUnload: function () {
            var i;
            for (i = 0; i < patches.length; i++) {
                if (typeof patches[i] === "function") patches[i]();
            }
            patches = [];
        },
        settings: Settings,
    };
})(vendetta);
