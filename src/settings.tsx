import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

const { View, ScrollView } = ReactNative;

export default function Settings() {
    useProxy(storage);

    return (
        <ScrollView>
            <View>
                <Forms.FormSwitchRow
                    label="Probe mode"
                    value={storage.probeMode ?? true}
                    onValueChange={(value) => (storage.probeMode = value)}
                    note="Shows sanitized load/runtime probe toasts and logs for profile action components."
                />
                <Forms.FormSwitchRow
                    label="Probe: hide entire matched profile component"
                    value={storage.probeHideMatchedComponent ?? false}
                    onValueChange={(value) => (storage.probeHideMatchedComponent = value)}
                    note="Returns null from each matched profile/action/contact component render."
                />
                <Forms.FormSwitchRow
                    label="Probe: hide suspected action row"
                    value={storage.probeHideSuspectedActionRow ?? false}
                    onValueChange={(value) => (storage.probeHideSuspectedActionRow = value)}
                    note="Removes the highest-confidence action-row container inside the matched component."
                />
            </View>
        </ScrollView>
    );
}
