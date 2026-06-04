import { logger } from "@vendetta";
import { findByName, findByProps } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";
import Settings from "./settings";

type ActionKey = "addFriend" | "message" | "call";
type ArraySlot = {
    owner: Record<string, any>;
    key: "children";
    buttons: any[];
    path: string;
};

const PLUGIN_NAME = "SafeProfileActions";
const ACTION_KEYS: ActionKey[] = ["addFriend", "message", "call"];
const CONTACT_ROW_INDEX_ACTIONS: ActionKey[] = ["addFriend", "message", "call"];
const ACTION_DISPLAY_NAMES: Record<ActionKey, string> = {
    addFriend: "Add Friend",
    message: "Message",
    call: "Call",
};
const DEBUG_TOAST_ICON = "ic_message";

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
let debugToastCache = new Set<string>();

function isDebugEnabled() {
    return Boolean(storage.debugMode ?? DEFAULT_SETTINGS.debugMode);
}

function log(method: "log" | "warn" | "error", message: string, metadata?: Record<string, unknown>) {
    if (metadata) logger[method](`[${PLUGIN_NAME}] ${message}`, metadata);
    else logger[method](`[${PLUGIN_NAME}] ${message}`);
}

function debugLog(message: string, metadata?: Record<string, unknown>) {
    if (!isDebugEnabled()) return;
    log("log", message, metadata);
}

function debugToastOnce(key: string, message: string) {
    if (!isDebugEnabled() || debugToastCache.has(key)) return;

    debugToastCache.add(key);

    try {
        showToast(`[${PLUGIN_NAME}] ${message}`, getAssetIDByName(DEBUG_TOAST_ICON));
    } catch {}
}

function initSettings() {
    storage.hideAddFriend ??= DEFAULT_SETTINGS.hideAddFriend;
    storage.hideMessage ??= DEFAULT_SETTINGS.hideMessage;
    storage.hideCall ??= DEFAULT_SETTINGS.hideCall;
    storage.debugMode ??= DEFAULT_SETTINGS.debugMode;
}

function initAssetIds() {
    for (const action of ACTION_KEYS) {
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

function uniqueActions(actions: ActionKey[]) {
    return [...new Set(actions)];
}

function summarizeActions(actions: ActionKey[]) {
    const names = uniqueActions(actions).map((action) => ACTION_DISPLAY_NAMES[action]);
    return names.join(", ");
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
        labels: uniqueStrings(strings).slice(0, 8),
        assetNames: uniqueStrings(assetRefs.map(resolveAssetName).filter((value): value is string => Boolean(value))).slice(0, 8),
    };
}

function sanitizeLabelsForDebug(labels: string[]) {
    const hints = new Set<string>();

    for (const label of labels) {
        for (const action of ACTION_KEYS) {
            if (ACTION_LABELS[action].some((needle) => label === needle || label.includes(needle))) {
                hints.add(ACTION_DISPLAY_NAMES[action]);
            }
        }
    }

    return [...hints];
}

function getDebugMetadata(node: Record<string, any>) {
    const metadata = extractMetadata(node);
    return {
        propKeys: metadata.propKeys,
        labelHints: sanitizeLabelsForDebug(metadata.labels),
        assetNames: metadata.assetNames,
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

    for (const action of ACTION_KEYS) {
        if (matchesNeedle(metadata.labels, ACTION_LABELS[action])) return action;
    }

    for (const action of ACTION_KEYS) {
        if (matchesKnownProps(node, action)) return action;
    }

    for (const action of ACTION_KEYS) {
        if (matchesAsset(node, action)) return action;
    }

    return null;
}

function shouldHide(action: ActionKey) {
    if (action === "addFriend") return Boolean(storage.hideAddFriend ?? DEFAULT_SETTINGS.hideAddFriend);
    if (action === "message") return Boolean(storage.hideMessage ?? DEFAULT_SETTINGS.hideMessage);
    return Boolean(storage.hideCall ?? DEFAULT_SETTINGS.hideCall);
}

function getChildrenArraySlot(owner: Record<string, any> | null | undefined, basePath: string): ArraySlot | null {
    if (!isObject(owner)) return null;

    if (Array.isArray(owner.children)) {
        return {
            owner,
            key: "children",
            buttons: owner.children,
            path: `${basePath}.children`,
        };
    }

    if (isObject(owner.children?.props) && Array.isArray(owner.children.props.children)) {
        return {
            owner: owner.children.props,
            key: "children",
            buttons: owner.children.props.children,
            path: `${basePath}.children.props.children`,
        };
    }

    return null;
}

function getUserProfileActionsSlot(component: any) {
    return (
        getChildrenArraySlot(component?.props?.children?.props?.children?.[1]?.props, "component.props.children.props.children[1].props") ??
        getChildrenArraySlot(component?.props?.children?.[1]?.props, "component.props.children[1].props")
    );
}

function getContactButtonsSlot(component: any) {
    return (
        getChildrenArraySlot(component?.props, "component.props") ??
        getChildrenArraySlot(component?.props?.children?.props, "component.props.children.props")
    );
}

function logButtonScan(componentName: string, buttonPath: string, node: any, matchedAction: ActionKey | null, fallbackAction?: ActionKey | null) {
    if (!isDebugEnabled() || !isObject(node) || !isObject(node.props)) return;

    const metadata = getDebugMetadata(node);
    debugLog(`Scanned button in ${componentName}.`, {
        buttonPath,
        matchedAction,
        fallbackAction: fallbackAction ?? null,
        propKeys: metadata.propKeys,
        labelHints: metadata.labelHints,
        assetNames: metadata.assetNames,
    });
}

function removeButtonsFromArray(
    buttons: any[],
    componentName: string,
    rowPath: string,
    allowIndexFallback: boolean,
) {
    const removed: ActionKey[] = [];
    let anyChanged = false;
    const nextButtons = buttons.filter((button, index) => {
        const buttonPath = `${rowPath}[${index}]`;
        const matchedAction = isObject(button) ? getMatchedAction(button) : null;
        const fallbackAction =
            !matchedAction && allowIndexFallback && buttons.length === CONTACT_ROW_INDEX_ACTIONS.length
                ? CONTACT_ROW_INDEX_ACTIONS[index] ?? null
                : null;

        logButtonScan(componentName, buttonPath, button, matchedAction, fallbackAction);

        const nestedSlot = isObject(button) && isObject(button.props)
            ? getChildrenArraySlot(button.props, `${buttonPath}.props`)
            : null;

        if (nestedSlot) {
            const nestedResult = removeButtonsFromArray(nestedSlot.buttons, componentName, nestedSlot.path, false);
            if (nestedResult.changed) {
                nestedSlot.owner[nestedSlot.key] = nestedResult.buttons;
                anyChanged = true;
            }

            removed.push(...nestedResult.removed);

            if (nestedResult.buttons.length === 0 && !matchedAction) {
                anyChanged = true;
                return false;
            }
        }

        const actionToRemove = matchedAction ?? fallbackAction;
        if (!actionToRemove || !shouldHide(actionToRemove)) return true;

        removed.push(actionToRemove);
        anyChanged = true;

        debugLog(`Removed ${ACTION_DISPLAY_NAMES[actionToRemove]} from ${componentName}.`, {
            buttonPath,
            reason: matchedAction ? "matched" : "indexFallback",
        });

        return false;
    });

    return {
        buttons: nextButtons,
        changed: anyChanged || nextButtons.length !== buttons.length,
        removed: uniqueActions(removed),
    };
}

function pruneProfileActionRow(component: any, componentName: string) {
    const slot =
        componentName === "UserProfileActions" ? getUserProfileActionsSlot(component) : getContactButtonsSlot(component);

    if (!slot) {
        debugLog(`No targeted action row found for ${componentName}.`);
        debugToastOnce(`row-missing:${componentName}`, `${componentName} row not found`);
        return component;
    }

    debugLog(`Found targeted action row for ${componentName}.`, {
        rowPath: slot.path,
        buttonsSeen: slot.buttons.length,
    });
    debugToastOnce(`row-found:${componentName}:${slot.path}`, `${componentName}: saw ${slot.buttons.length} buttons`);

    const result = removeButtonsFromArray(
        slot.buttons,
        componentName,
        slot.path,
        true,
    );

    if (result.changed) {
        slot.owner[slot.key] = result.buttons;
    }

    debugLog(`Finished targeted prune for ${componentName}.`, {
        rowPath: slot.path,
        buttonsSeen: slot.buttons.length,
        buttonsRemaining: result.buttons.length,
        removed: result.removed.map((action) => ACTION_DISPLAY_NAMES[action]),
    });

    if (result.removed.length > 0) {
        debugToastOnce(
            `removed:${componentName}:${slot.path}:${result.removed.join(",")}`,
            `${componentName}: removed ${summarizeActions(result.removed)}`,
        );
    }

    return component;
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
        const metadata = getDebugMetadata(node);
        debugLog(`Fallback removed ${ACTION_DISPLAY_NAMES[matchedAction]} from ${componentName}.`, {
            propKeys: metadata.propKeys,
            labelHints: metadata.labelHints,
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
        debugToastOnce(`component-missing:${componentName}`, `${componentName} not found`);
        return;
    }

    debugLog(`Component found: ${componentName}.`);
    debugToastOnce(`component-found:${componentName}`, `${componentName} patched`);

    try {
        patches.push(
            after("default", module, (_, rendered) => {
                try {
                    const targeted = pruneProfileActionRow(rendered, componentName);
                    return pruneTree(targeted, componentName);
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
            if (!entry.module) {
                debugLog(`Component unavailable on this build: ${entry.name}.`);
                debugToastOnce(`component-unavailable:${entry.name}`, `${entry.name} unavailable`);
            }
            continue;
        }

        seen.add(entry.module);
        patchProfileComponent(entry.module, entry.name);
    }
}

export default {
    onLoad: () => {
        initSettings();
        debugToastCache = new Set();
        initAssetIds();
        log("log", "Plugin loaded.");
        debugToastOnce("plugin-loaded", "Plugin loaded");
        loadPatches();
    },

    onUnload: () => {
        for (const unpatch of patches) unpatch();
        patches = [];
        debugToastCache = new Set();
    },

    settings: Settings,
};
