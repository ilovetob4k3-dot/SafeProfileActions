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

function safeUnpatch() {
    if (typeof unpatchAddRelationship === "function") {
        try {
            unpatchAddRelationship();
        } catch {}
    }

    unpatchAddRelationship = null;
}

export default {
    onLoad: () => {
        try {
            initSettings();
            safeUnpatch();

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
