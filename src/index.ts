import { logger } from "@vendetta";
import { findByName, findByProps } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";
import Settings from "./settings";

type PatchCandidate = {
    componentName: string;
    owner: Record<string, any>;
    key: string;
    source: string;
    exactTarget: boolean;
};

type ParentLink =
    | { mode: "array"; owner: any[]; index: number; path: string }
    | { mode: "prop"; owner: Record<string, any>; key: string; path: string };

type ProbeSummary = {
    hasChildren: boolean;
    immediateChildrenCount: number;
    buttonLikeCount: number;
    propKeys: string[];
    accessibilityLabel: string | null;
    visibleLabels: string[];
    iconSourceNames: string[];
};

type SuspectedRow = {
    path: string;
    parentLink: ParentLink | null;
    immediateChildrenCount: number;
    directButtonLikeChildren: number;
    buttonLikeCount: number;
    visibleLabels: string[];
    iconSourceNames: string[];
    score: number;
};

const PLUGIN_NAME = "SafeProfileActions";
const TOAST_ICON = "ic_message";
const EXACT_TARGETS = [
    "UserProfileActions",
    "SimplifiedUserProfileContactButtons",
    "UserProfileContactButtons",
];
const RUNTIME_SEARCH_TERMS = [
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
const SAFE_LABEL_HINTS = [
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
const DEFAULT_SETTINGS = {
    probeMode: true,
    probeHideMatchedComponent: false,
    probeHideSuspectedActionRow: false,
};

const reverseAssetLookup = findByProps("getAssetByID");

let patches: Array<() => void> = [];
let toastCache = new Set<string>();
let patchedKeys = new WeakMap<object, Set<string>>();

function initSettings() {
    storage.probeMode ??= DEFAULT_SETTINGS.probeMode;
    storage.probeHideMatchedComponent ??= DEFAULT_SETTINGS.probeHideMatchedComponent;
    storage.probeHideSuspectedActionRow ??= DEFAULT_SETTINGS.probeHideSuspectedActionRow;
}

function isProbeEnabled() {
    return Boolean(storage.probeMode ?? DEFAULT_SETTINGS.probeMode);
}

function log(method: "log" | "warn" | "error", message: string, metadata?: Record<string, unknown>) {
    if (metadata) logger[method](`[${PLUGIN_NAME}] ${message}`, metadata);
    else logger[method](`[${PLUGIN_NAME}] ${message}`);
}

function debugLog(message: string, metadata?: Record<string, unknown>) {
    if (!isProbeEnabled()) return;
    log("log", message, metadata);
}

function showToastOnce(key: string, message: string, force = false) {
    if (!force && !isProbeEnabled()) return;
    if (toastCache.has(key)) return;

    toastCache.add(key);

    try {
        showToast(message, getAssetIDByName(TOAST_ICON));
    } catch {}
}

function normalizeText(value: string) {
    return String(value)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function uniqueStrings(values: string[]) {
    return [...new Set(values.filter(Boolean))];
}

function isObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null;
}

function getImmediateChildren(node: any) {
    const children = node?.props?.children;

    if (children == null) return [];
    if (Array.isArray(children)) return children.filter((child) => child != null);

    return [children];
}

function isButtonLikeNode(node: any) {
    if (!isObject(node) || !isObject(node.props)) return false;

    const props = node.props;
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

function extractSafeLabelHints(input: string) {
    const normalized = normalizeText(input);
    if (!normalized) return [];

    const hits = SAFE_LABEL_HINTS.filter((needle) => normalized.includes(needle));
    return uniqueStrings(hits);
}

function collectSafeLabels(value: unknown, results: string[], visited = new WeakSet<object>(), depth = 0) {
    if (value == null || depth > 4) return;

    if (typeof value === "string") {
        results.push(...extractSafeLabelHints(value));
        return;
    }

    if (!isObject(value) || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
        for (const item of value) collectSafeLabels(item, results, visited, depth + 1);
        return;
    }

    for (const key of ["accessibilityLabel", "label", "text", "title", "children"]) {
        if (value[key] != null) collectSafeLabels(value[key], results, visited, depth + 1);
    }

    if (value.props != null) collectSafeLabels(value.props, results, visited, depth + 1);
}

function collectAssetRefs(value: unknown, results: unknown[], visited = new WeakSet<object>(), depth = 0) {
    if (value == null || depth > 4) return;
    if (!isObject(value) || visited.has(value)) return;
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

function summarizeButtonLikeTree(node: any, bucket: { count: number; labels: string[]; icons: string[] }, depth = 0) {
    if (node == null || depth > 6) return;

    if (Array.isArray(node)) {
        for (const child of node) summarizeButtonLikeTree(child, bucket, depth + 1);
        return;
    }

    if (!isObject(node)) return;

    if (isButtonLikeNode(node)) {
        bucket.count += 1;
        collectSafeLabels(node.props, bucket.labels);

        const refs: unknown[] = [];
        collectAssetRefs(node.props, refs);
        bucket.icons.push(...refs.map(resolveAssetName).filter((value): value is string => Boolean(value)));
    }

    if (isObject(node.props) && node.props.children != null) {
        summarizeButtonLikeTree(node.props.children, bucket, depth + 1);
    }
}

function sanitizeAccessibilityLabel(value: unknown) {
    if (typeof value !== "string") return null;

    const hits = extractSafeLabelHints(value);
    return hits[0] ?? "present-redacted";
}

function getProbeSummary(rendered: any): ProbeSummary {
    const props = isObject(rendered?.props) ? rendered.props : {};
    const bucket = {
        count: 0,
        labels: [] as string[],
        icons: [] as string[],
    };

    summarizeButtonLikeTree(rendered, bucket);

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

function countButtonLikeNodes(node: any, depth = 0): number {
    if (node == null || depth > 5) return 0;
    if (Array.isArray(node)) return node.reduce((sum, child) => sum + countButtonLikeNodes(child, depth + 1), 0);
    if (!isObject(node)) return 0;

    const ownCount = isButtonLikeNode(node) ? 1 : 0;
    return ownCount + countButtonLikeNodes(node?.props?.children, depth + 1);
}

function collectNodeHints(node: any) {
    const labels: string[] = [];
    const iconNames: string[] = [];

    collectSafeLabels(node?.props ?? {}, labels);

    const refs: unknown[] = [];
    collectAssetRefs(node?.props ?? {}, refs);
    iconNames.push(...refs.map(resolveAssetName).filter((value): value is string => Boolean(value)));

    return {
        labels: uniqueStrings(labels).slice(0, 6),
        iconNames: uniqueStrings(iconNames).slice(0, 6),
    };
}

function maybePushRowCandidate(
    candidates: SuspectedRow[],
    node: any,
    path: string,
    parentLink: ParentLink | null,
    depth: number,
) {
    const immediateChildren = getImmediateChildren(node).filter((child) => child != null);
    if (immediateChildren.length === 0 || immediateChildren.length > 10) return;

    const directButtonLikeChildren = immediateChildren.filter((child) => isButtonLikeNode(child)).length;
    const buttonLikeCount = immediateChildren.reduce((sum, child) => sum + countButtonLikeNodes(child), 0);
    if (buttonLikeCount === 0) return;

    const hints = collectNodeHints(node);
    const score =
        directButtonLikeChildren * 100 +
        buttonLikeCount * 20 +
        (hints.labels.length > 0 ? 10 : 0) +
        (hints.iconNames.length > 0 ? 10 : 0) -
        depth;

    candidates.push({
        path,
        parentLink,
        immediateChildrenCount: immediateChildren.length,
        directButtonLikeChildren,
        buttonLikeCount,
        visibleLabels: hints.labels,
        iconSourceNames: hints.iconNames,
        score,
    });
}

function collectRowCandidates(
    node: any,
    path: string,
    parentLink: ParentLink | null,
    depth: number,
    candidates: SuspectedRow[],
) {
    if (node == null || depth > 6) return;

    if (Array.isArray(node)) {
        node.forEach((child, index) =>
            collectRowCandidates(
                child,
                `${path}[${index}]`,
                { mode: "array", owner: node, index, path: `${path}[${index}]` },
                depth + 1,
                candidates,
            ),
        );
        return;
    }

    if (!isObject(node) || !isObject(node.props)) return;

    maybePushRowCandidate(candidates, node, path, parentLink, depth);

    const children = node.props.children;
    if (Array.isArray(children)) {
        children.forEach((child, index) =>
            collectRowCandidates(
                child,
                `${path}.props.children[${index}]`,
                { mode: "array", owner: children, index, path: `${path}.props.children[${index}]` },
                depth + 1,
                candidates,
            ),
        );
        return;
    }

    if (children != null) {
        collectRowCandidates(
            children,
            `${path}.props.children`,
            { mode: "prop", owner: node.props, key: "children", path: `${path}.props.children` },
            depth + 1,
            candidates,
        );
    }
}

function findSuspectedActionRow(rendered: any) {
    const candidates: SuspectedRow[] = [];
    collectRowCandidates(rendered, "component", null, 0, candidates);
    if (candidates.length === 0) return null;

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0];
}

function hideSuspectedRow(rendered: any, row: SuspectedRow) {
    if (row.parentLink?.mode === "array") {
        row.parentLink.owner.splice(row.parentLink.index, 1);
        return true;
    }

    if (row.parentLink?.mode === "prop") {
        row.parentLink.owner[row.parentLink.key] = null;
        return true;
    }

    if (isObject(rendered?.props)) {
        rendered.props.children = null;
        return true;
    }

    return false;
}

function matchesRuntimeSearch(name: string) {
    const normalized = normalizeText(name);
    if (!normalized) return false;

    return RUNTIME_SEARCH_TERMS.some((term) => normalized.includes(normalizeText(term)));
}

function looksLikeProfileComponentName(name: string) {
    const normalized = normalizeText(name);
    return ["profile", "action", "contact", "button", "relationship", "sheet"].some((term) =>
        normalized.includes(term),
    );
}

function getCandidateNames(value: any, exportKey?: string) {
    const names: string[] = [];

    if (exportKey) names.push(exportKey);

    if (typeof value === "function") {
        if (typeof value.displayName === "string") names.push(value.displayName);
        if (typeof value.name === "string") names.push(value.name);
    }

    if (isObject(value)) {
        if (typeof value.displayName === "string") names.push(value.displayName);
        if (typeof value.name === "string") names.push(value.name);
        if (typeof value.type?.displayName === "string") names.push(value.type.displayName);
        if (typeof value.type?.name === "string") names.push(value.type.name);
        if (typeof value.render?.displayName === "string") names.push(value.render.displayName);
        if (typeof value.render?.name === "string") names.push(value.render.name);
    }

    return uniqueStrings(names.filter(Boolean));
}

function getMetroModuleRegistry() {
    const globalAny = globalThis as any;
    const candidates = [
        globalAny.__r?.getModules?.(),
        globalAny.modules,
        globalAny.vendetta?.metro?.modules,
        globalAny.vendetta?.metro?.metroModules,
        globalAny.__vendetta_loader?.modules,
    ];

    return candidates.find((candidate) => isObject(candidate) || Array.isArray(candidate)) ?? null;
}

function getModuleExports(record: any) {
    return (
        record?.publicModule?.exports ??
        record?.module?.exports ??
        record?.exports ??
        null
    );
}

function addPatchedKey(owner: object, key: string) {
    const existing = patchedKeys.get(owner) ?? new Set<string>();
    if (existing.has(key)) return false;

    existing.add(key);
    patchedKeys.set(owner, existing);
    return true;
}

function maybeCreatePatchCandidate(
    owner: Record<string, any> | null,
    key: string,
    value: any,
    componentName: string,
    source: string,
    exactTarget: boolean,
): PatchCandidate | null {
    if (!owner || !key) return null;

    if (typeof value === "function" && looksLikeProfileComponentName(componentName)) {
        return { componentName, owner, key, source, exactTarget };
    }

    if (isObject(value) && typeof value.type === "function" && looksLikeProfileComponentName(componentName)) {
        return { componentName, owner: value, key: "type", source: `${source}:${key}.type`, exactTarget };
    }

    if (isObject(value) && typeof value.render === "function" && looksLikeProfileComponentName(componentName)) {
        return { componentName, owner: value, key: "render", source: `${source}:${key}.render`, exactTarget };
    }

    return null;
}

function createNamedLookupCandidates(name: string, module: any) {
    const candidates: PatchCandidate[] = [];

    if (isObject(module)) {
        for (const key of ["default", "type", "render"]) {
            if (module[key] == null) continue;

            const candidate = maybeCreatePatchCandidate(module, key, module[key], name, `findByName:${name}`, true);
            if (candidate) candidates.push(candidate);
        }
    }

    return candidates;
}

function scanRuntimeCandidates() {
    const exactStatuses = new Map<string, boolean>();
    const hits = new Set<string>();
    const patchCandidates: PatchCandidate[] = [];
    const seenCandidateIds = new Set<string>();

    for (const name of [...EXACT_TARGETS, ...RUNTIME_SEARCH_TERMS]) {
        const module = findByName(name, false);
        const found = module != null;

        if (EXACT_TARGETS.includes(name)) exactStatuses.set(name, found);
        if (!found) continue;

        hits.add(name);

        for (const candidate of createNamedLookupCandidates(name, module)) {
            const candidateId = `${candidate.componentName}:${candidate.source}:${candidate.key}`;
            if (seenCandidateIds.has(candidateId)) continue;

            seenCandidateIds.add(candidateId);
            patchCandidates.push(candidate);
        }
    }

    const registry = getMetroModuleRegistry();
    if (!registry) {
        return {
            exactStatuses,
            hitNames: [...hits],
            patchCandidates,
        };
    }

    for (const [moduleId, record] of Object.entries(registry)) {
        try {
            const exportsObject = getModuleExports(record);
            if (exportsObject == null) continue;

            const namedEntries: Array<{ owner: Record<string, any>; key: string; value: any }> = [];

            if (typeof exportsObject === "function") {
                const publicModule = record?.publicModule;
                if (isObject(publicModule)) {
                    namedEntries.push({ owner: publicModule, key: "exports", value: exportsObject });
                }
            }

            if (isObject(exportsObject)) {
                if (exportsObject.default != null) {
                    namedEntries.push({ owner: exportsObject, key: "default", value: exportsObject.default });
                }

                for (const key of Object.keys(exportsObject)) {
                    namedEntries.push({ owner: exportsObject, key, value: exportsObject[key] });
                }
            }

            for (const entry of namedEntries) {
                for (const candidateName of getCandidateNames(entry.value, entry.key)) {
                    if (!matchesRuntimeSearch(candidateName)) continue;

                    hits.add(candidateName);

                    if (EXACT_TARGETS.includes(candidateName)) {
                        exactStatuses.set(candidateName, true);
                    }

                    const candidate = maybeCreatePatchCandidate(
                        entry.owner,
                        entry.key,
                        entry.value,
                        candidateName,
                        `metro:${moduleId}`,
                        EXACT_TARGETS.includes(candidateName),
                    );

                    if (!candidate) continue;

                    const candidateId = `${candidate.componentName}:${candidate.source}:${candidate.key}`;
                    if (seenCandidateIds.has(candidateId)) continue;

                    seenCandidateIds.add(candidateId);
                    patchCandidates.push(candidate);
                }
            }
        } catch (error) {
            debugLog("Metro candidate scan failed for one module.", {
                moduleId,
                error: String(error),
            });
        }
    }

    return {
        exactStatuses,
        hitNames: [...hits].sort((left, right) => left.localeCompare(right)),
        patchCandidates,
    };
}

function reportDiscovery(exactStatuses: Map<string, boolean>, hitNames: string[], patchCandidates: PatchCandidate[]) {
    for (const target of EXACT_TARGETS) {
        const found = exactStatuses.get(target) === true;
        debugLog(`Target ${found ? "found" : "missing"}: ${target}.`);
        showToastOnce(
            `target:${target}:${found ? "found" : "missing"}`,
            found ? `${target} found` : `${target} not found`,
        );
    }

    const extras = uniqueStrings(
        patchCandidates
            .map((candidate) => candidate.componentName)
            .filter((name) => !EXACT_TARGETS.includes(name)),
    );

    debugLog("Runtime Metro probe summary.", {
        hitCount: hitNames.length,
        hits: hitNames.slice(0, 40),
        patchableCandidates: uniqueStrings(patchCandidates.map((candidate) => candidate.componentName)),
    });

    showToastOnce("probe-hit-summary", `Runtime probe hits: ${hitNames.length}`);

    extras.slice(0, 5).forEach((name) => {
        showToastOnce(`candidate:${name}`, `Candidate: ${name}`);
    });

    if (extras.length > 5) {
        showToastOnce("candidate:more", `More candidates: ${extras.length - 5}`);
    }
}

function runProbe(componentName: string, rendered: any) {
    const summary = getProbeSummary(rendered);

    debugLog(`Rendered ${componentName}.`, {
        componentName,
        hasChildren: summary.hasChildren,
        immediateChildrenCount: summary.immediateChildrenCount,
        buttonLikeCount: summary.buttonLikeCount,
        propKeys: summary.propKeys,
        accessibilityLabel: summary.accessibilityLabel,
        visibleLabels: summary.visibleLabels,
        iconSourceNames: summary.iconSourceNames,
    });

    showToastOnce(
        `render:${componentName}:${summary.immediateChildrenCount}:${summary.buttonLikeCount}:${summary.visibleLabels.join("|")}`,
        `${componentName}: children ${summary.immediateChildrenCount}, buttons ${summary.buttonLikeCount}`,
    );

    if (storage.probeHideMatchedComponent) {
        showToastOnce(`hide-component:${componentName}`, `${componentName}: returned null`);
        debugLog(`Returned null for ${componentName}.`);
        return null;
    }

    const row = findSuspectedActionRow(rendered);

    if (!row) {
        showToastOnce(`row-missing:${componentName}`, `${componentName}: no suspected row`);
        debugLog(`No suspected action row found for ${componentName}.`);
        return rendered;
    }

    debugLog(`Suspected action row for ${componentName}.`, {
        componentName,
        rowPath: row.path,
        immediateChildrenCount: row.immediateChildrenCount,
        directButtonLikeChildren: row.directButtonLikeChildren,
        buttonLikeCount: row.buttonLikeCount,
        visibleLabels: row.visibleLabels,
        iconSourceNames: row.iconSourceNames,
        score: row.score,
    });

    showToastOnce(
        `row:${componentName}:${row.path}:${row.buttonLikeCount}`,
        `${componentName}: row buttons ${row.buttonLikeCount}`,
    );

    if (!storage.probeHideSuspectedActionRow) return rendered;

    const hidden = hideSuspectedRow(rendered, row);

    showToastOnce(
        `hide-row:${componentName}:${hidden ? "ok" : "fail"}`,
        hidden ? `${componentName}: row hidden` : `${componentName}: row hide failed`,
    );

    debugLog(`${hidden ? "Removed" : "Failed to remove"} suspected action row for ${componentName}.`, {
        rowPath: row.path,
    });

    return rendered;
}

function patchCandidate(candidate: PatchCandidate) {
    if (!addPatchedKey(candidate.owner, candidate.key)) return;

    debugLog(`Patching ${candidate.componentName}.`, {
        source: candidate.source,
        key: candidate.key,
        exactTarget: candidate.exactTarget,
    });

    try {
        patches.push(
            after(candidate.key, candidate.owner, (_, rendered) => {
                try {
                    return runProbe(candidate.componentName, rendered);
                } catch (error) {
                    debugLog(`Probe failed for ${candidate.componentName}.`, {
                        error: String(error),
                    });
                    return rendered;
                }
            }),
        );
    } catch (error) {
        debugLog(`Failed to patch ${candidate.componentName}.`, {
            source: candidate.source,
            key: candidate.key,
            error: String(error),
        });
    }
}

function loadPatches() {
    const discovery = scanRuntimeCandidates();
    reportDiscovery(discovery.exactStatuses, discovery.hitNames, discovery.patchCandidates);

    for (const candidate of discovery.patchCandidates) {
        patchCandidate(candidate);
    }
}

export default {
    onLoad: () => {
        initSettings();
        toastCache = new Set();
        patchedKeys = new WeakMap();

        log("log", "Plugin loaded.");

        try {
            showToast("SafeProfileActions loaded", getAssetIDByName(TOAST_ICON));
        } catch {}

        loadPatches();
    },

    onUnload: () => {
        for (const unpatch of patches) unpatch();
        patches = [];
        toastCache = new Set();
        patchedKeys = new WeakMap();
    },

    settings: Settings,
};
