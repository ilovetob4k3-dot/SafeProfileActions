import { logger } from "@vendetta";
import { findByProps } from "@vendetta/metro";
import { instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { showToast } from "@vendetta/ui/toasts";
import Settings from "./settings";

const DEFAULT_SETTINGS = {
    showBlockToast: false,
};

let unpatchAddRelationship: (() => void) | null = null;
let unpatchReactionActions: Array<() => void> = [];

const REACTION_ADD_METHOD_NAMES = [
    "addReaction",
    "addMessageReaction",
    "createReaction",
    "toggleReaction",
    "addReactionBurst",
    "addBurstReaction",
] as const;

const REACTION_DETECTION_METHOD_NAMES = ["removeReaction"] as const;
const REACTION_METHOD_NAMES = [...REACTION_ADD_METHOD_NAMES, ...REACTION_DETECTION_METHOD_NAMES] as const;
const DIAGNOSTIC_PREFIX = "[SafeProfileActions ReactionTracer]";
const MAX_STACK_FRAMES = 8;

type YesNo = "yes" | "no";

type ReactionDiagnostic = {
    reactionActionModuleFound: YesNo;
    reactionAddFunctionPatched: YesNo;
    reactionAddFunctionFired: YesNo;
    reactionFunctionName: string;
    argCountTypesOnly: string;
    argObjectKeysOnly: string;
    reactionBurstFlagPresent: YesNo;
    reactionBurstFlagTruthy: YesNo;
    sanitizedCallStack: string[];
};

function initSettings() {
    storage.showBlockToast ??= DEFAULT_SETTINGS.showBlockToast;
}

function resolveRelationshipManager() {
    const relationshipManager = findByProps("addRelationship");
    return typeof relationshipManager?.addRelationship === "function" ? relationshipManager : null;
}

function shouldAllowOriginal(args: any[]) {
    const payload = Array.isArray(args) ? args[0] : null;
    return Boolean(payload && typeof payload === "object" && payload.type === 2);
}

function showBlockedToast() {
    if (!storage.showBlockToast) return;

    try {
        showToast("oops lol", getAssetIDByName("ic_message"));
    } catch {}
}

function yesNo(value: boolean): YesNo {
    return value ? "yes" : "no";
}

function sanitizeFunctionName(value: string) {
    const sanitized = value.replace(/[^A-Za-z0-9_$]/g, "");
    return sanitized || "unknown";
}

function getArgType(value: unknown) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

function getArgCountTypesOnly(args: unknown[]) {
    const types = args.map((arg) => getArgType(arg));
    return `count=${args.length}; types=[${types.join(", ")}]`;
}

function getArgObjectKeysOnly(args: unknown[]) {
    const summaries = args.map((arg, index) => {
        if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
            return `arg${index}:[]`;
        }

        const keys = Object.keys(arg as Record<string, unknown>).sort();
        return `arg${index}:[${keys.join(", ")}]`;
    });

    return summaries.join(" | ") || "none";
}

function getReactionBurstFlagState(args: unknown[]) {
    const arg4 = Array.isArray(args) ? args[3] : undefined;
    const hasBurstKey =
        !!arg4 &&
        typeof arg4 === "object" &&
        !Array.isArray(arg4) &&
        Object.prototype.hasOwnProperty.call(arg4, "burst");
    const burstValue = hasBurstKey ? (arg4 as { burst?: unknown }).burst : undefined;

    return {
        reactionBurstFlagPresent: yesNo(hasBurstKey),
        reactionBurstFlagTruthy: yesNo(Boolean(burstValue)),
    };
}

function sanitizeStackLine(line: string) {
    const trimmed = line.trim().replace(/^at\s+/, "");
    const beforeParen = trimmed.split("(")[0].trim();
    const matched = beforeParen.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g);
    const candidate = matched?.[matched.length - 1] ?? "";

    return candidate || "anonymous";
}

function getSanitizedCallStack() {
    const stack = new Error().stack;
    if (!stack) return [];

    return stack
        .split("\n")
        .slice(2)
        .map(sanitizeStackLine)
        .filter(Boolean)
        .slice(0, MAX_STACK_FRAMES);
}

function createReactionDiagnostic(overrides: Partial<ReactionDiagnostic> = {}): ReactionDiagnostic {
    return {
        reactionActionModuleFound: "no",
        reactionAddFunctionPatched: "no",
        reactionAddFunctionFired: "no",
        reactionFunctionName: "none",
        argCountTypesOnly: "count=0; types=[]",
        argObjectKeysOnly: "none",
        reactionBurstFlagPresent: "no",
        reactionBurstFlagTruthy: "no",
        sanitizedCallStack: [],
        ...overrides,
    };
}

function formatReactionDiagnostic(diagnostic: ReactionDiagnostic) {
    const stackLines = diagnostic.sanitizedCallStack.length
        ? diagnostic.sanitizedCallStack.map((frame) => `- ${frame}`).join("\n")
        : "- none";

    return [
        `reaction action module found: ${diagnostic.reactionActionModuleFound}`,
        `reaction add function patched: ${diagnostic.reactionAddFunctionPatched}`,
        `reaction add function fired: ${diagnostic.reactionAddFunctionFired}`,
        `reaction function name: ${diagnostic.reactionFunctionName}`,
        `arg count/types only: ${diagnostic.argCountTypesOnly}`,
        `arg object keys only: ${diagnostic.argObjectKeysOnly}`,
        `reaction burst flag present: ${diagnostic.reactionBurstFlagPresent}`,
        `reaction burst flag truthy: ${diagnostic.reactionBurstFlagTruthy}`,
        "sanitized call stack:",
        stackLines,
    ].join("\n");
}

function commitReactionDiagnostic(diagnostic: ReactionDiagnostic) {
    storage.reactionDiagnostic = diagnostic;
    storage.reactionDiagnosticText = formatReactionDiagnostic(diagnostic);
}

function showReactionTracerToast(functionName: string) {
    try {
        showToast(`Reaction tracer: ${functionName}`, getAssetIDByName("ic_message"));
    } catch {}
}

function safePushUnpatch(unpatch: unknown) {
    if (typeof unpatch === "function") {
        unpatchReactionActions.push(unpatch);
    }
}

function patchReactionActions() {
    if (!instead || typeof findByProps !== "function") {
        commitReactionDiagnostic(createReactionDiagnostic());
        return;
    }

    const patchedMethods = new Set<string>();
    const hasPatchedAddFunction = () =>
        REACTION_ADD_METHOD_NAMES.some((methodName) => patchedMethods.has(methodName));
    let moduleFound = false;

    for (const methodName of REACTION_METHOD_NAMES) {
        const module = findByProps(methodName);

        if (!module || typeof module[methodName] !== "function" || patchedMethods.has(methodName)) {
            continue;
        }

        moduleFound = true;

        const unpatch = instead(methodName, module, (args, orig) => {
            const sanitizedMethodName = sanitizeFunctionName(methodName);
            const normalizedArgs = Array.isArray(args) ? args : [];
            const diagnostic = createReactionDiagnostic({
                reactionActionModuleFound: yesNo(moduleFound),
                reactionAddFunctionPatched: yesNo(hasPatchedAddFunction()),
                reactionAddFunctionFired: yesNo(REACTION_ADD_METHOD_NAMES.includes(methodName as (typeof REACTION_ADD_METHOD_NAMES)[number])),
                reactionFunctionName: sanitizedMethodName,
                argCountTypesOnly: getArgCountTypesOnly(normalizedArgs),
                argObjectKeysOnly: getArgObjectKeysOnly(normalizedArgs),
                ...getReactionBurstFlagState(normalizedArgs),
                sanitizedCallStack: getSanitizedCallStack(),
            });

            commitReactionDiagnostic(diagnostic);
            logger.log(`${DIAGNOSTIC_PREFIX}\n${formatReactionDiagnostic(diagnostic)}`);
            showReactionTracerToast(sanitizedMethodName);

            return typeof orig === "function" ? orig.apply(module, args) : undefined;
        });

        safePushUnpatch(unpatch);
        patchedMethods.add(methodName);
    }

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

    for (const unpatch of unpatchReactionActions) {
        try {
            unpatch();
        } catch {}
    }

    unpatchReactionActions = [];
}

export default {
    onLoad: () => {
        try {
            initSettings();
            safeUnpatch();
            patchReactionActions();

            const relationshipManager = resolveRelationshipManager();
            if (!relationshipManager) return;

            unpatchAddRelationship = instead("addRelationship", relationshipManager, (args, orig) => {
                if (shouldAllowOriginal(args)) {
                    return typeof orig === "function" ? orig.apply(relationshipManager, args) : undefined;
                }

                showBlockedToast();
                return Promise.resolve(null);
            });
        } catch {}
    },

    onUnload: () => {
        safeUnpatch();
    },

    settings: Settings,
};
