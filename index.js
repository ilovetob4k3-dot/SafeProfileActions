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
    var showToast = typeof toasts.showToast === "function" ? toasts.showToast : null;
    var useProxy = typeof storageApi.useProxy === "function" ? storageApi.useProxy : null;

    var React = common.React || null;
    var ReactNative = common.ReactNative || {};
    var View = ReactNative.View || null;
    var ScrollView = ReactNative.ScrollView || null;

    var PLUGIN_NAME = "SafeProfileActions";
    var TOAST_ICON = "ic_message";
    var EXACT_TARGETS = [
        "UserProfileActions",
        "SimplifiedUserProfileContactButtons",
        "UserProfileContactButtons",
    ];
    var RUNTIME_SEARCH_TERMS = [
        "UserProfile",
        "ProfileActions",
        "ContactButtons",
        "Relationship",
        "FriendRequest",
        "AddFriend",
        "addFriend",
        "sendFriendRequest",
        "USER_BOTTOM_SHEET",
        "ProfileButton",
        "UserProfileAction",
    ];
    var SAFE_LABEL_HINTS = [
        "add friend",
        "send friend request",
        "friend request",
        "message",
        "send message",
        "call",
        "voice call",
        "audio call",
        "phone call",
        "profile action",
        "profile button",
        "contact button",
        "contact buttons",
        "relationship",
        "user profile",
    ];
    var DEFAULT_SETTINGS = {
        probeMode: true,
        probeHideMatchedComponent: false,
        probeHideSuspectedActionRow: false,
    };

    var reverseAssetLookup = findByProps ? findByProps("getAssetByID") : null;
    var patches = [];
    var toastCache = new Set();
    var patchedKeys = new WeakMap();

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
                    label: "Probe mode",
                    value: storage.probeMode == null ? true : storage.probeMode,
                    onValueChange: function (value) {
                        storage.probeMode = value;
                    },
                    note: "Shows sanitized load/runtime probe toasts and logs for profile action components.",
                }),
                React.createElement(Forms.FormSwitchRow, {
                    label: "Probe: hide entire matched profile component",
                    value:
                        storage.probeHideMatchedComponent == null
                            ? false
                            : storage.probeHideMatchedComponent,
                    onValueChange: function (value) {
                        storage.probeHideMatchedComponent = value;
                    },
                    note: "Returns null from each matched profile/action/contact component render.",
                }),
                React.createElement(Forms.FormSwitchRow, {
                    label: "Probe: hide suspected action row",
                    value:
                        storage.probeHideSuspectedActionRow == null
                            ? false
                            : storage.probeHideSuspectedActionRow,
                    onValueChange: function (value) {
                        storage.probeHideSuspectedActionRow = value;
                    },
                    note: "Removes the highest-confidence action-row container inside the matched component.",
                })
            )
        );
    }

    function initSettings() {
        if (storage.probeMode == null) storage.probeMode = DEFAULT_SETTINGS.probeMode;
        if (storage.probeHideMatchedComponent == null) {
            storage.probeHideMatchedComponent = DEFAULT_SETTINGS.probeHideMatchedComponent;
        }
        if (storage.probeHideSuspectedActionRow == null) {
            storage.probeHideSuspectedActionRow = DEFAULT_SETTINGS.probeHideSuspectedActionRow;
        }
    }

    function isProbeEnabled() {
        return Boolean(storage.probeMode == null ? DEFAULT_SETTINGS.probeMode : storage.probeMode);
    }

    function log(method, message, metadata) {
        if (!logger || typeof logger[method] !== "function") return;
        if (metadata === undefined) logger[method]("[" + PLUGIN_NAME + "] " + message);
        else logger[method]("[" + PLUGIN_NAME + "] " + message, metadata);
    }

    function debugLog(message, metadata) {
        if (!isProbeEnabled()) return;
        log("log", message, metadata);
    }

    function showToastOnce(key, message, force) {
        if (force == null) force = false;
        if (!force && !isProbeEnabled()) return;
        if (toastCache.has(key) || !showToast) return;

        toastCache.add(key);

        try {
            showToast(message, getAssetIDByName ? getAssetIDByName(TOAST_ICON) : void 0);
        } catch {}
    }

    function normalizeText(value) {
        return String(value)
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/[_-]+/g, " ")
            .toLowerCase()
            .replace(/[^a-z0-9 ]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function uniqueStrings(values) {
        var seen = new Set();
        var results = [];
        var i;

        for (i = 0; i < values.length; i++) {
            var value = values[i];
            if (!value || seen.has(value)) continue;
            seen.add(value);
            results.push(value);
        }

        return results;
    }

    function isObject(value) {
        return typeof value === "object" && value !== null;
    }

    function getImmediateChildren(node) {
        var children = node && node.props ? node.props.children : null;

        if (children == null) return [];
        if (Array.isArray(children)) return children.filter(function (child) { return child != null; });

        return [children];
    }

    function isButtonLikeNode(node) {
        var props;

        if (!isObject(node) || !isObject(node.props)) return false;

        props = node.props;
        return (
            typeof props.onPress === "function" ||
            typeof props.onLongPress === "function" ||
            props.accessibilityRole === "button" ||
            props.role === "button" ||
            props.icon != null ||
            props.source != null ||
            props.IconComponent != null
        );
    }

    function extractSafeLabelHints(input) {
        var normalized = normalizeText(input);
        var hits = [];
        var i;

        if (!normalized) return hits;

        for (i = 0; i < SAFE_LABEL_HINTS.length; i++) {
            if (normalized.indexOf(SAFE_LABEL_HINTS[i]) !== -1) hits.push(SAFE_LABEL_HINTS[i]);
        }

        return uniqueStrings(hits);
    }

    function collectSafeLabels(value, results, visited, depth) {
        var i;
        var key;
        var keys;

        if (!visited) visited = new WeakSet();
        if (depth == null) depth = 0;
        if (value == null || depth > 4) return;

        if (typeof value === "string") {
            var labels = extractSafeLabelHints(value);
            for (i = 0; i < labels.length; i++) results.push(labels[i]);
            return;
        }

        if (!isObject(value) || visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value)) {
            for (i = 0; i < value.length; i++) {
                collectSafeLabels(value[i], results, visited, depth + 1);
            }
            return;
        }

        keys = ["accessibilityLabel", "label", "text", "title", "children"];
        for (i = 0; i < keys.length; i++) {
            key = keys[i];
            if (value[key] != null) collectSafeLabels(value[key], results, visited, depth + 1);
        }

        if (value.props != null) collectSafeLabels(value.props, results, visited, depth + 1);
    }

    function collectAssetRefs(value, results, visited, depth) {
        var i;
        var key;
        var keys;

        if (!visited) visited = new WeakSet();
        if (depth == null) depth = 0;
        if (value == null || depth > 4) return;
        if (!isObject(value) || visited.has(value)) return;
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
            var asset =
                reverseAssetLookup && reverseAssetLookup.getAssetByID
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

    function summarizeButtonLikeTree(node, bucket, depth) {
        var refs;
        var i;

        if (depth == null) depth = 0;
        if (node == null || depth > 6) return;

        if (Array.isArray(node)) {
            for (i = 0; i < node.length; i++) summarizeButtonLikeTree(node[i], bucket, depth + 1);
            return;
        }

        if (!isObject(node)) return;

        if (isButtonLikeNode(node)) {
            bucket.count += 1;
            collectSafeLabels(node.props, bucket.labels);

            refs = [];
            collectAssetRefs(node.props, refs);
            for (i = 0; i < refs.length; i++) {
                var assetName = resolveAssetName(refs[i]);
                if (assetName) bucket.icons.push(assetName);
            }
        }

        if (isObject(node.props) && node.props.children != null) {
            summarizeButtonLikeTree(node.props.children, bucket, depth + 1);
        }
    }

    function sanitizeAccessibilityLabel(value) {
        if (typeof value !== "string") return null;

        var hits = extractSafeLabelHints(value);
        return hits[0] || "present-redacted";
    }

    function getProbeSummary(rendered) {
        var props = isObject(rendered && rendered.props) ? rendered.props : {};
        var bucket = { count: 0, labels: [], icons: [] };

        summarizeButtonLikeTree(rendered, bucket, 0);

        return {
            hasChildren: props.children != null,
            immediateChildrenCount: getImmediateChildren(rendered).length,
            buttonLikeCount: bucket.count,
            propKeys: Object.keys(props).sort(),
            accessibilityLabel: sanitizeAccessibilityLabel(props.accessibilityLabel),
            visibleLabels: uniqueStrings(bucket.labels).slice(0, 8),
            iconSourceNames: uniqueStrings(bucket.icons).slice(0, 8),
        };
    }

    function countButtonLikeNodes(node, depth) {
        var ownCount;
        var i;
        var sum;

        if (depth == null) depth = 0;
        if (node == null || depth > 5) return 0;
        if (Array.isArray(node)) {
            sum = 0;
            for (i = 0; i < node.length; i++) sum += countButtonLikeNodes(node[i], depth + 1);
            return sum;
        }
        if (!isObject(node)) return 0;

        ownCount = isButtonLikeNode(node) ? 1 : 0;
        return ownCount + countButtonLikeNodes(node && node.props ? node.props.children : null, depth + 1);
    }

    function collectNodeHints(node) {
        var labels = [];
        var refs = [];
        var iconNames = [];
        var i;

        collectSafeLabels((node && node.props) || {}, labels);
        collectAssetRefs((node && node.props) || {}, refs);

        for (i = 0; i < refs.length; i++) {
            var assetName = resolveAssetName(refs[i]);
            if (assetName) iconNames.push(assetName);
        }

        return {
            labels: uniqueStrings(labels).slice(0, 6),
            iconNames: uniqueStrings(iconNames).slice(0, 6),
        };
    }

    function maybePushRowCandidate(candidates, node, path, parentLink, depth) {
        var immediateChildren = getImmediateChildren(node).filter(function (child) { return child != null; });
        var directButtonLikeChildren;
        var buttonLikeCount;
        var hints;
        var score;
        var i;

        if (immediateChildren.length === 0 || immediateChildren.length > 10) return;

        directButtonLikeChildren = 0;
        buttonLikeCount = 0;

        for (i = 0; i < immediateChildren.length; i++) {
            if (isButtonLikeNode(immediateChildren[i])) directButtonLikeChildren += 1;
            buttonLikeCount += countButtonLikeNodes(immediateChildren[i], 0);
        }

        if (buttonLikeCount === 0) return;

        hints = collectNodeHints(node);
        score =
            directButtonLikeChildren * 100 +
            buttonLikeCount * 20 +
            (hints.labels.length > 0 ? 10 : 0) +
            (hints.iconNames.length > 0 ? 10 : 0) -
            depth;

        candidates.push({
            path: path,
            parentLink: parentLink,
            immediateChildrenCount: immediateChildren.length,
            directButtonLikeChildren: directButtonLikeChildren,
            buttonLikeCount: buttonLikeCount,
            visibleLabels: hints.labels,
            iconSourceNames: hints.iconNames,
            score: score,
        });
    }

    function collectRowCandidates(node, path, parentLink, depth, candidates) {
        var children;
        var i;

        if (node == null || depth > 6) return;

        if (Array.isArray(node)) {
            for (i = 0; i < node.length; i++) {
                collectRowCandidates(
                    node[i],
                    path + "[" + i + "]",
                    { mode: "array", owner: node, index: i, path: path + "[" + i + "]" },
                    depth + 1,
                    candidates
                );
            }
            return;
        }

        if (!isObject(node) || !isObject(node.props)) return;

        maybePushRowCandidate(candidates, node, path, parentLink, depth);

        children = node.props.children;
        if (Array.isArray(children)) {
            for (i = 0; i < children.length; i++) {
                collectRowCandidates(
                    children[i],
                    path + ".props.children[" + i + "]",
                    {
                        mode: "array",
                        owner: children,
                        index: i,
                        path: path + ".props.children[" + i + "]",
                    },
                    depth + 1,
                    candidates
                );
            }
            return;
        }

        if (children != null) {
            collectRowCandidates(
                children,
                path + ".props.children",
                { mode: "prop", owner: node.props, key: "children", path: path + ".props.children" },
                depth + 1,
                candidates
            );
        }
    }

    function findSuspectedActionRow(rendered) {
        var candidates = [];

        collectRowCandidates(rendered, "component", null, 0, candidates);
        if (!candidates.length) return null;

        candidates.sort(function (left, right) {
            return right.score - left.score;
        });

        return candidates[0];
    }

    function hideSuspectedRow(rendered, row) {
        if (row.parentLink && row.parentLink.mode === "array") {
            row.parentLink.owner.splice(row.parentLink.index, 1);
            return true;
        }

        if (row.parentLink && row.parentLink.mode === "prop") {
            row.parentLink.owner[row.parentLink.key] = null;
            return true;
        }

        if (isObject(rendered && rendered.props)) {
            rendered.props.children = null;
            return true;
        }

        return false;
    }

    function matchesRuntimeSearch(name) {
        var normalized = normalizeText(name);
        var i;

        if (!normalized) return false;

        for (i = 0; i < RUNTIME_SEARCH_TERMS.length; i++) {
            if (normalized.indexOf(normalizeText(RUNTIME_SEARCH_TERMS[i])) !== -1) return true;
        }

        return false;
    }

    function looksLikeProfileComponentName(name) {
        var normalized = normalizeText(name);
        var terms = ["profile", "action", "contact", "button", "relationship", "sheet"];
        var i;

        for (i = 0; i < terms.length; i++) {
            if (normalized.indexOf(terms[i]) !== -1) return true;
        }

        return false;
    }

    function getCandidateNames(value, exportKey) {
        var names = [];

        if (exportKey) names.push(exportKey);

        if (typeof value === "function") {
            if (typeof value.displayName === "string") names.push(value.displayName);
            if (typeof value.name === "string") names.push(value.name);
        }

        if (isObject(value)) {
            if (typeof value.displayName === "string") names.push(value.displayName);
            if (typeof value.name === "string") names.push(value.name);
            if (value.type && typeof value.type.displayName === "string") names.push(value.type.displayName);
            if (value.type && typeof value.type.name === "string") names.push(value.type.name);
            if (value.render && typeof value.render.displayName === "string") names.push(value.render.displayName);
            if (value.render && typeof value.render.name === "string") names.push(value.render.name);
        }

        return uniqueStrings(names.filter(Boolean));
    }

    function getMetroModuleRegistry() {
        var globalAny = typeof globalThis !== "undefined" ? globalThis : {};
        var candidates = [
            globalAny.__r && typeof globalAny.__r.getModules === "function" ? globalAny.__r.getModules() : null,
            globalAny.modules,
            globalAny.vendetta && globalAny.vendetta.metro ? globalAny.vendetta.metro.modules : null,
            globalAny.vendetta && globalAny.vendetta.metro ? globalAny.vendetta.metro.metroModules : null,
            globalAny.__vendetta_loader ? globalAny.__vendetta_loader.modules : null,
        ];
        var i;

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

    function addPatchedKey(owner, key) {
        var existing = patchedKeys.get(owner) || new Set();

        if (existing.has(key)) return false;

        existing.add(key);
        patchedKeys.set(owner, existing);
        return true;
    }

    function maybeCreatePatchCandidate(owner, key, value, componentName, source, exactTarget) {
        if (!owner || !key) return null;

        if (typeof value === "function" && looksLikeProfileComponentName(componentName)) {
            return {
                componentName: componentName,
                owner: owner,
                key: key,
                source: source,
                exactTarget: exactTarget,
            };
        }

        if (isObject(value) && typeof value.type === "function" && looksLikeProfileComponentName(componentName)) {
            return {
                componentName: componentName,
                owner: value,
                key: "type",
                source: source + ":" + key + ".type",
                exactTarget: exactTarget,
            };
        }

        if (isObject(value) && typeof value.render === "function" && looksLikeProfileComponentName(componentName)) {
            return {
                componentName: componentName,
                owner: value,
                key: "render",
                source: source + ":" + key + ".render",
                exactTarget: exactTarget,
            };
        }

        return null;
    }

    function createNamedLookupCandidates(name, module) {
        var candidates = [];
        var keys = ["default", "type", "render"];
        var i;

        if (!isObject(module)) return candidates;

        for (i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (module[key] == null) continue;

            var candidate = maybeCreatePatchCandidate(module, key, module[key], name, "findByName:" + name, true);
            if (candidate) candidates.push(candidate);
        }

        return candidates;
    }

    function scanRuntimeCandidates() {
        var exactStatuses = new Map();
        var hits = new Set();
        var patchCandidates = [];
        var seenCandidateIds = new Set();
        var namesToLookup = EXACT_TARGETS.concat(RUNTIME_SEARCH_TERMS);
        var registry;
        var registryEntries;
        var i;

        for (i = 0; i < namesToLookup.length; i++) {
            var name = namesToLookup[i];
            var module = findByName ? findByName(name, false) : null;
            var found = module != null;

            if (EXACT_TARGETS.indexOf(name) !== -1) exactStatuses.set(name, found);
            if (!found) continue;

            hits.add(name);

            var lookupCandidates = createNamedLookupCandidates(name, module);
            for (var j = 0; j < lookupCandidates.length; j++) {
                var lookupCandidate = lookupCandidates[j];
                var lookupId =
                    lookupCandidate.componentName + ":" + lookupCandidate.source + ":" + lookupCandidate.key;
                if (seenCandidateIds.has(lookupId)) continue;

                seenCandidateIds.add(lookupId);
                patchCandidates.push(lookupCandidate);
            }
        }

        registry = getMetroModuleRegistry();
        if (!registry) {
            return {
                exactStatuses: exactStatuses,
                hitNames: Array.from(hits),
                patchCandidates: patchCandidates,
            };
        }

        registryEntries = Object.entries(registry);
        for (i = 0; i < registryEntries.length; i++) {
            var moduleId = registryEntries[i][0];
            var record = registryEntries[i][1];

            try {
                var exportsObject = getModuleExports(record);
                var namedEntries = [];
                var publicModule;
                var exportKeys;
                var k;

                if (exportsObject == null) continue;

                publicModule = record && record.publicModule ? record.publicModule : null;
                if (typeof exportsObject === "function" && isObject(publicModule)) {
                    namedEntries.push({ owner: publicModule, key: "exports", value: exportsObject });
                }

                if (isObject(exportsObject)) {
                    if (exportsObject.default != null) {
                        namedEntries.push({ owner: exportsObject, key: "default", value: exportsObject.default });
                    }

                    exportKeys = Object.keys(exportsObject);
                    for (k = 0; k < exportKeys.length; k++) {
                        namedEntries.push({
                            owner: exportsObject,
                            key: exportKeys[k],
                            value: exportsObject[exportKeys[k]],
                        });
                    }
                }

                for (k = 0; k < namedEntries.length; k++) {
                    var entry = namedEntries[k];
                    var candidateNames = getCandidateNames(entry.value, entry.key);
                    var n;

                    for (n = 0; n < candidateNames.length; n++) {
                        var candidateName = candidateNames[n];
                        if (!matchesRuntimeSearch(candidateName)) continue;

                        hits.add(candidateName);

                        if (EXACT_TARGETS.indexOf(candidateName) !== -1) {
                            exactStatuses.set(candidateName, true);
                        }

                        var candidate = maybeCreatePatchCandidate(
                            entry.owner,
                            entry.key,
                            entry.value,
                            candidateName,
                            "metro:" + moduleId,
                            EXACT_TARGETS.indexOf(candidateName) !== -1
                        );

                        if (!candidate) continue;

                        var candidateId = candidate.componentName + ":" + candidate.source + ":" + candidate.key;
                        if (seenCandidateIds.has(candidateId)) continue;

                        seenCandidateIds.add(candidateId);
                        patchCandidates.push(candidate);
                    }
                }
            } catch (error) {
                debugLog("Metro candidate scan failed for one module.", {
                    moduleId: moduleId,
                    error: String(error),
                });
            }
        }

        return {
            exactStatuses: exactStatuses,
            hitNames: Array.from(hits).sort(),
            patchCandidates: patchCandidates,
        };
    }

    function reportDiscovery(exactStatuses, hitNames, patchCandidates) {
        var extras;
        var extraNames;
        var i;

        for (i = 0; i < EXACT_TARGETS.length; i++) {
            var target = EXACT_TARGETS[i];
            var found = exactStatuses.get(target) === true;

            debugLog("Target " + (found ? "found" : "missing") + ": " + target + ".");
            showToastOnce(
                "target:" + target + ":" + (found ? "found" : "missing"),
                found ? target + " found" : target + " not found"
            );
        }

        extras = [];
        for (i = 0; i < patchCandidates.length; i++) {
            if (EXACT_TARGETS.indexOf(patchCandidates[i].componentName) === -1) {
                extras.push(patchCandidates[i].componentName);
            }
        }

        extraNames = uniqueStrings(extras);

        debugLog("Runtime Metro probe summary.", {
            hitCount: hitNames.length,
            hits: hitNames.slice(0, 40),
            patchableCandidates: uniqueStrings(
                patchCandidates.map(function (candidate) {
                    return candidate.componentName;
                })
            ),
        });

        showToastOnce("probe-hit-summary", "Runtime probe hits: " + hitNames.length);

        for (i = 0; i < extraNames.length && i < 5; i++) {
            showToastOnce("candidate:" + extraNames[i], "Candidate: " + extraNames[i]);
        }

        if (extraNames.length > 5) {
            showToastOnce("candidate:more", "More candidates: " + (extraNames.length - 5));
        }
    }

    function runProbe(componentName, rendered) {
        var summary = getProbeSummary(rendered);
        var row;
        var hidden;

        debugLog("Rendered " + componentName + ".", {
            componentName: componentName,
            hasChildren: summary.hasChildren,
            immediateChildrenCount: summary.immediateChildrenCount,
            buttonLikeCount: summary.buttonLikeCount,
            propKeys: summary.propKeys,
            accessibilityLabel: summary.accessibilityLabel,
            visibleLabels: summary.visibleLabels,
            iconSourceNames: summary.iconSourceNames,
        });

        showToastOnce(
            "render:" +
                componentName +
                ":" +
                summary.immediateChildrenCount +
                ":" +
                summary.buttonLikeCount +
                ":" +
                summary.visibleLabels.join("|"),
            componentName + ": children " + summary.immediateChildrenCount + ", buttons " + summary.buttonLikeCount
        );

        if (storage.probeHideMatchedComponent) {
            showToastOnce("hide-component:" + componentName, componentName + ": returned null");
            debugLog("Returned null for " + componentName + ".");
            return null;
        }

        row = findSuspectedActionRow(rendered);
        if (!row) {
            showToastOnce("row-missing:" + componentName, componentName + ": no suspected row");
            debugLog("No suspected action row found for " + componentName + ".");
            return rendered;
        }

        debugLog("Suspected action row for " + componentName + ".", {
            componentName: componentName,
            rowPath: row.path,
            immediateChildrenCount: row.immediateChildrenCount,
            directButtonLikeChildren: row.directButtonLikeChildren,
            buttonLikeCount: row.buttonLikeCount,
            visibleLabels: row.visibleLabels,
            iconSourceNames: row.iconSourceNames,
            score: row.score,
        });

        showToastOnce(
            "row:" + componentName + ":" + row.path + ":" + row.buttonLikeCount,
            componentName + ": row buttons " + row.buttonLikeCount
        );

        if (!storage.probeHideSuspectedActionRow) return rendered;

        hidden = hideSuspectedRow(rendered, row);

        showToastOnce(
            "hide-row:" + componentName + ":" + (hidden ? "ok" : "fail"),
            hidden ? componentName + ": row hidden" : componentName + ": row hide failed"
        );

        debugLog((hidden ? "Removed" : "Failed to remove") + " suspected action row for " + componentName + ".", {
            rowPath: row.path,
        });

        return rendered;
    }

    function patchCandidate(candidate) {
        if (!candidate || !candidate.owner || !candidate.key || !after) return;
        if (!addPatchedKey(candidate.owner, candidate.key)) return;

        debugLog("Patching " + candidate.componentName + ".", {
            source: candidate.source,
            key: candidate.key,
            exactTarget: candidate.exactTarget,
        });

        try {
            patches.push(
                after(candidate.key, candidate.owner, function (_, rendered) {
                    try {
                        return runProbe(candidate.componentName, rendered);
                    } catch (error) {
                        debugLog("Probe failed for " + candidate.componentName + ".", {
                            error: String(error),
                        });
                        return rendered;
                    }
                })
            );
        } catch (error) {
            debugLog("Failed to patch " + candidate.componentName + ".", {
                source: candidate.source,
                key: candidate.key,
                error: String(error),
            });
        }
    }

    function loadPatches() {
        var discovery = scanRuntimeCandidates();
        var i;

        reportDiscovery(discovery.exactStatuses, discovery.hitNames, discovery.patchCandidates);

        for (i = 0; i < discovery.patchCandidates.length; i++) {
            patchCandidate(discovery.patchCandidates[i]);
        }
    }

    return {
        onLoad: function () {
            initSettings();
            toastCache = new Set();
            patchedKeys = new WeakMap();

            log("log", "Plugin loaded.");

            try {
                if (showToast) {
                    showToast(
                        "SafeProfileActions loaded",
                        getAssetIDByName ? getAssetIDByName(TOAST_ICON) : void 0
                    );
                }
            } catch {}

            loadPatches();
        },

        onUnload: function () {
            var i;
            for (i = 0; i < patches.length; i++) patches[i]();
            patches = [];
            toastCache = new Set();
            patchedKeys = new WeakMap();
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
