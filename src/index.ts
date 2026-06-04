import { logger } from "@vendetta";
import { findByName, findByProps } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import Settings from "./settings";

type ActionKey = "addFriend" | "message" | "call";

const PLUGIN_NAME = "SafeProfileActions";

const DEFAULT_SETTINGS = {
    hideAddFriend: true,
    hideMessage: true,
    hideCall: false,
    debugMode: false,
};

const ACTION_LABELS: Record<ActionKey, string[]> = {
    addFriend: ["add friend", "send friend request"],
    message: ["message", "send message"],
    call: ["call", "voice call", "audio call", "phone call", "start call"],
};

const ACTION_ASSET_NAMES: Record<ActionKey, string[]> = {
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

const reverseAssetLookup = findByProps("getAssetByID");
const assetIds: Record<ActionKey, Set<unknown>> = {
    addFriend: new Set(),
    message: new Set(),
    call: new Set(),
};

let patches: Array<() => void> = [];

function isDebugEnabled() {
    return Boolean(storage.debugMode ?? DEFAULT_SETTINGS.debugMode);
}

function debugLog(message: string, metadata?: Record<string, unknown>) {
    if (!isDebugEnabled()) return;

    if (metadata) logger.log(`[${PLUGIN_NAME}] ${message}`, metadata);
    else logger.log(`[${PLUGIN_NAME}] ${message}`);
}

function initSettings() {
    storage.hideAddFriend ??= DEFAULT_SETTINGS.hideAddFriend;
    storage.hideMessage ??= DEFAULT_SETTINGS.hideMessage;
    storage.hideCall ??= DEFAULT_SETTINGS.hideCall;
    storage.debugMode ??= DEFAULT_SETTINGS.debugMode;
}

function initAssetIds() {
    for (const action of Object.keys(ACTION_ASSET_NAMES) as ActionKey[]) {
        assetIds[action].clear();

        for (const assetName of ACTION_ASSET_NAMES[action]) {
            const assetId = getAssetIDByName(assetName);
            if (assetId != null) assetIds[action].add(assetId);
        }
    }
}

function normalizeText(value: string) {
    return value
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function uniqueStrings(values: string[]) {
    return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function isObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null;
}

function collectStrings(value: unknown, results: string[], visited = new WeakSet<object>(), depth = 0) {
    if (value == null || depth > 4) return;
    if (typeof value === "string") {
        results.push(value);
        return;
    }

    if (typeof value !== "object") return;
    if (visited.has(value as object)) return;
    visited.add(value as object);

    if (Array.isArray(value)) {
        for (const item of value) collectStrings(item, results, visited, depth + 1);
        return;
    }

    const record = value as Record<string, any>;

    for (const key of ["accessibilityLabel", "label", "text", "title", "children"]) {
        if (record[key] != null) collectStrings(record[key], results, visited, depth + 1);
    }

    if (record.props != null) collectStrings(record.props, results, visited, depth + 1);
}

function collectAssetRefs(value: unknown, results: unknown[], visited = new WeakSet<object>(), depth = 0) {
    if (value == null || depth > 3) return;
    if (!isObject(value)) return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
        for (const item of value) collectAssetRefs(item, results, visited, depth + 1);
        return;
    }

    for (const key of ["icon", "source"]) {
        if (value[key] != null) results.push(value[key]);
    }

    if (value.props != null) collectAssetRefs(value.props, results, visited, depth + 1);
    if (value.children != null) collectAssetRefs(value.children, results, visited, depth + 1);
}

function resolveAssetName(assetRef: unknown) {
    if (typeof assetRef === "string") return assetRef;

    if (typeof assetRef === "number") {
        const asset = reverseAssetLookup?.getAssetByID?.(assetRef);
        return typeof asset?.name === "string" ? asset.name : null;
    }

    if (!isObject(assetRef)) return null;

    for (const key of ["name", "iconName", "asset", "uri"]) {
        if (typeof assetRef[key] === "string") return assetRef[key];
    }

    return null;
}

function extractMetadata(node: Record<string, any>) {
    const strings: string[] = [];
    const assetRefs: unknown[] = [];
    const props = node.props ?? {};

    collectStrings(props, strings);
    collectAssetRefs(props, assetRefs);

    return {
        propKeys: Object.keys(props).sort(),
        accessibilityLabel: typeof props.accessibilityLabel === "string" ? props.accessibilityLabel : null,
        labels: uniqueStrings(strings).slice(0, 6),
        assetNames: uniqueStrings(assetRefs.map(resolveAssetName).filter((value): value is string => Boolean(value))).slice(0, 6),
    };
}

function matchesNeedle(labels: string[], needles: string[]) {
    return labels.some((label) => needles.some((needle) => label === needle || label.includes(needle)));
}

function matchesKnownProps(node: Record<string, any>, action: ActionKey) {
    const props = node.props ?? {};
    const candidates = uniqueStrings(
        ["action", "type", "testID", "analyticsName", "iconName", "name"]
            .map((key) => props[key])
            .filter((value): value is string => typeof value === "string"),
    );

    return matchesNeedle(candidates, ACTION_LABELS[action]);
}

function matchesAsset(node: Record<string, any>, action: ActionKey) {
    const refs: unknown[] = [];
    collectAssetRefs(node.props ?? {}, refs);
    return refs.some((value) => assetIds[action].has(value));
}

function getMatchedAction(node: Record<string, any>): ActionKey | null {
    const props = node.props ?? {};
    const isButtonLike =
        typeof props.onPress === "function" ||
        typeof props.onLongPress === "function" ||
        props.accessibilityRole === "button" ||
        props.role === "button" ||
        props.icon != null ||
        props.source != null ||
        props.IconComponent != null;

    if (!isButtonLike) return null;

    const metadata = extractMetadata(node);

    for (const action of ["addFriend", "message", "call"] as ActionKey[]) {
        if (matchesNeedle(metadata.labels, ACTION_LABELS[action])) return action;
    }

    for (const action of ["addFriend", "message", "call"] as ActionKey[]) {
        if (matchesKnownProps(node, action)) return action;
    }

    for (const action of ["addFriend", "message", "call"] as ActionKey[]) {
        if (matchesAsset(node, action)) return action;
    }

    return null;
}

function shouldHide(action: ActionKey) {
    if (action === "addFriend") return Boolean(storage.hideAddFriend ?? DEFAULT_SETTINGS.hideAddFriend);
    if (action === "message") return Boolean(storage.hideMessage ?? DEFAULT_SETTINGS.hideMessage);
    return Boolean(storage.hideCall ?? DEFAULT_SETTINGS.hideCall);
}

function pruneTree(node: any, componentName: string): any {
    if (Array.isArray(node)) {
        return node
            .map((child) => pruneTree(child, componentName))
            .filter((child) => child != null);
    }

    if (!isObject(node) || !isObject(node.props)) return node;

    const matchedAction = getMatchedAction(node);
    if (matchedAction && shouldHide(matchedAction)) {
        const metadata = extractMetadata(node);
        debugLog(`Removed ${matchedAction} button from ${componentName}.`, {
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

function patchProfileComponent(module: any, componentName: string) {
    if (!module) {
        debugLog(`Component not found: ${componentName}.`);
        return;
    }

    try {
        patches.push(
            after("default", module, (_, rendered) => {
                try {
                    return pruneTree(rendered, componentName);
                } catch (error) {
                    debugLog(`Failed to traverse ${componentName}.`, {
                        error: String(error),
                    });
                    return rendered;
                }
            }),
        );
    } catch (error) {
        debugLog(`Failed to patch ${componentName}.`, {
            error: String(error),
        });
    }
}

function loadPatches() {
    const modules = [
        { name: "UserProfileActions", module: findByName("UserProfileActions", false) },
        {
            name: "SimplifiedUserProfileContactButtons",
            module: findByName("SimplifiedUserProfileContactButtons", false),
        },
        {
            name: "UserProfileContactButtons",
            module: findByName("UserProfileContactButtons", false),
        },
    ];

    const seen = new Set<any>();

    for (const entry of modules) {
        if (!entry.module || seen.has(entry.module)) {
            if (!entry.module) debugLog(`Component unavailable on this build: ${entry.name}.`);
            continue;
        }

        seen.add(entry.module);
        patchProfileComponent(entry.module, entry.name);
    }
}

export default {
    onLoad: () => {
        initSettings();
        initAssetIds();
        loadPatches();
    },

    onUnload: () => {
        for (const unpatch of patches) unpatch();
        patches = [];
    },

    settings: Settings,
};
