(function (vendetta) {
    "use strict";

    vendetta = vendetta || {};

    var rootLogger = vendetta.logger || console || { log: function () {} };
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
    var clipboard = common.clipboard || null;
    var ReactNative = common.ReactNative || {};
    var Clipboard = ReactNative.Clipboard || null;
    var ScrollView = ReactNative.ScrollView || null;
    var View = ReactNative.View || null;
    var FormRow = Forms.FormRow || null;
    var FormSection = Forms.FormSection || null;
    var FormText = Forms.FormText || null;
    var FormSwitchRow = Forms.FormSwitchRow || null;

    var DEFAULT_SETTINGS = {
        showBlockToast: false,
    };

    var unpatchAddRelationship = null;
    var unpatchReactionActions = [];
    var REACTION_ADD_METHOD_NAMES = [
        "addReaction",
        "addMessageReaction",
        "createReaction",
        "toggleReaction",
        "addReactionBurst",
        "addBurstReaction",
    ];
    var REACTION_DETECTION_METHOD_NAMES = ["removeReaction"];
    var REACTION_METHOD_NAMES = REACTION_ADD_METHOD_NAMES.concat(REACTION_DETECTION_METHOD_NAMES);
    var DIAGNOSTIC_PREFIX = "[SafeProfileActions ReactionTracer]";
    var MAX_STACK_FRAMES = 8;

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

    function yesNo(value) {
        return value ? "yes" : "no";
    }

    function sanitizeFunctionName(value) {
        var sanitized = String(value || "").replace(/[^A-Za-z0-9_$]/g, "");
        return sanitized || "unknown";
    }

    function getArgType(value) {
        if (value === null) return "null";
        if (Array.isArray(value)) return "array";
        return typeof value;
    }

    function getArgCountTypesOnly(args) {
        var list = Array.isArray(args) ? args : [];
        var types = list.map(function (arg) {
            return getArgType(arg);
        });
        return "count=" + list.length + "; types=[" + types.join(", ") + "]";
    }

    function getArgObjectKeysOnly(args) {
        var list = Array.isArray(args) ? args : [];
        var summaries = list.map(function (arg, index) {
            var keys;

            if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
                return "arg" + index + ":[]";
            }

            keys = Object.keys(arg).sort();
            return "arg" + index + ":[" + keys.join(", ") + "]";
        });

        return summaries.join(" | ") || "none";
    }

    function sanitizeStackLine(line) {
        var trimmed = String(line || "").trim().replace(/^at\s+/, "");
        var beforeParen = trimmed.split("(")[0].trim();
        var matched = beforeParen.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g);
        var candidate = matched && matched.length ? matched[matched.length - 1] : "";

        return candidate || "anonymous";
    }

    function getSanitizedCallStack() {
        var stack = new Error().stack;
        if (!stack) return [];

        return stack
            .split("\n")
            .slice(2)
            .map(sanitizeStackLine)
            .filter(Boolean)
            .slice(0, MAX_STACK_FRAMES);
    }

    function createReactionDiagnostic(overrides) {
        var base = {
            reactionActionModuleFound: "no",
            reactionAddFunctionPatched: "no",
            reactionAddFunctionFired: "no",
            reactionFunctionName: "none",
            argCountTypesOnly: "count=0; types=[]",
            argObjectKeysOnly: "none",
            sanitizedCallStack: [],
        };

        if (!overrides || typeof overrides !== "object") {
            return base;
        }

        return Object.assign(base, overrides);
    }

    function formatReactionDiagnostic(diagnostic) {
        var stackLines = diagnostic.sanitizedCallStack && diagnostic.sanitizedCallStack.length
            ? diagnostic.sanitizedCallStack.map(function (frame) {
                  return "- " + frame;
              }).join("\n")
            : "- none";

        return [
            "reaction action module found: " + diagnostic.reactionActionModuleFound,
            "reaction add function patched: " + diagnostic.reactionAddFunctionPatched,
            "reaction add function fired: " + diagnostic.reactionAddFunctionFired,
            "reaction function name: " + diagnostic.reactionFunctionName,
            "arg count/types only: " + diagnostic.argCountTypesOnly,
            "arg object keys only: " + diagnostic.argObjectKeysOnly,
            "sanitized call stack:",
            stackLines,
        ].join("\n");
    }

    function commitReactionDiagnostic(diagnostic) {
        storage.reactionDiagnostic = diagnostic;
        storage.reactionDiagnosticText = formatReactionDiagnostic(diagnostic);
    }

    function showReactionTracerToast(functionName) {
        if (!showToast) return;

        try {
            showToast("Reaction tracer: " + functionName, getAssetIDByName ? getAssetIDByName("ic_message") : void 0);
        } catch {}
    }

    function safePushUnpatch(unpatch) {
        if (typeof unpatch === "function") {
            unpatchReactionActions.push(unpatch);
        }
    }

    function patchReactionActions() {
        var patchedMethods, hasPatchedAddFunction, moduleFound;

        if (!instead || !findByProps) {
            commitReactionDiagnostic(createReactionDiagnostic());
            return;
        }

        patchedMethods = new Set();
        hasPatchedAddFunction = function () {
            return REACTION_ADD_METHOD_NAMES.some(function (methodName) {
                return patchedMethods.has(methodName);
            });
        };
        moduleFound = false;

        REACTION_METHOD_NAMES.forEach(function (methodName) {
            var module = findByProps(methodName);
            var unpatch;

            if (!module || typeof module[methodName] !== "function" || patchedMethods.has(methodName)) {
                return;
            }

            moduleFound = true;

            unpatch = instead(methodName, module, function (args, orig) {
                var sanitizedMethodName = sanitizeFunctionName(methodName);
                var diagnostic = createReactionDiagnostic({
                    reactionActionModuleFound: yesNo(moduleFound),
                    reactionAddFunctionPatched: yesNo(hasPatchedAddFunction()),
                    reactionAddFunctionFired: yesNo(REACTION_ADD_METHOD_NAMES.indexOf(methodName) !== -1),
                    reactionFunctionName: sanitizedMethodName,
                    argCountTypesOnly: getArgCountTypesOnly(Array.isArray(args) ? args : []),
                    argObjectKeysOnly: getArgObjectKeysOnly(Array.isArray(args) ? args : []),
                    sanitizedCallStack: getSanitizedCallStack(),
                });

                commitReactionDiagnostic(diagnostic);
                if (rootLogger && typeof rootLogger.log === "function") {
                    rootLogger.log(DIAGNOSTIC_PREFIX + "\n" + formatReactionDiagnostic(diagnostic));
                }
                showReactionTracerToast(sanitizedMethodName);

                return typeof orig === "function" ? orig.apply(module, args) : void 0;
            });

            safePushUnpatch(unpatch);
            patchedMethods.add(methodName);
        });

        commitReactionDiagnostic(
            createReactionDiagnostic({
                reactionActionModuleFound: yesNo(moduleFound),
                reactionAddFunctionPatched: yesNo(hasPatchedAddFunction()),
            })
        );
    }

    function safeUnpatch() {
        if (typeof unpatchAddRelationship === "function") {
            try {
                unpatchAddRelationship();
            } catch {}
        }

        unpatchAddRelationship = null;

        unpatchReactionActions.forEach(function (unpatch) {
            try {
                unpatch();
            } catch {}
        });

        unpatchReactionActions = [];
    }

    function Settings() {
        if (!React || !ScrollView || !View || !FormSwitchRow) return null;
        if (useProxy) useProxy(storage);

        function copyDiagnostic() {
            var diagnostic = String(storage.reactionDiagnosticText || "");
            var clipboardApi = clipboard || Clipboard;

            if (!diagnostic || !clipboardApi || typeof clipboardApi.setString !== "function") return;

            try {
                clipboardApi.setString(diagnostic);
                if (showToast) {
                    showToast("Reaction diagnostic copied.", getAssetIDByName ? getAssetIDByName("copy") : void 0);
                }
            } catch {}
        }

        var children = [
            React.createElement(FormSwitchRow, {
                key: "show-block-toast",
                label: "Show block toast",
                value: storage.showBlockToast == null ? DEFAULT_SETTINGS.showBlockToast : storage.showBlockToast,
                onValueChange: function (value) {
                    storage.showBlockToast = Boolean(value);
                },
                note: 'Shows "oops lol" when Add Friend is blocked.',
            }),
        ];

        if (FormSection && FormRow && FormText) {
            children.push(
                React.createElement(
                    FormSection,
                    {
                        key: "reaction-diagnostic",
                        title: "Reaction Diagnostic",
                    },
                    React.createElement(FormRow, {
                        label: "Copy latest diagnostic",
                        onPress: copyDiagnostic,
                    }),
                    React.createElement(
                        FormText,
                        { selectable: true },
                        String(storage.reactionDiagnosticText || "No diagnostic captured yet.")
                    )
                )
            );
        }

        return React.createElement(
            ScrollView,
            null,
            React.createElement(
                View,
                null,
                children
            )
        );
    }

    return {
        onLoad: function () {
            try {
                var relationshipManager;

                initSettings();
                safeUnpatch();
                patchReactionActions();

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
