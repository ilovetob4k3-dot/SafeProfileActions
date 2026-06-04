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
                    label="Hide Add Friend"
                    value={storage.hideAddFriend ?? true}
                    onValueChange={(value) => (storage.hideAddFriend = value)}
                    note="Hides the large Add Friend button on user profiles."
                />
                <Forms.FormSwitchRow
                    label="Hide Message"
                    value={storage.hideMessage ?? true}
                    onValueChange={(value) => (storage.hideMessage = value)}
                    note="Hides the message button on user profiles."
                />
                <Forms.FormSwitchRow
                    label="Hide Call"
                    value={storage.hideCall ?? false}
                    onValueChange={(value) => (storage.hideCall = value)}
                    note="Optionally hides the phone/call button on user profiles."
                />
                <Forms.FormSwitchRow
                    label="Debug mode"
                    value={storage.debugMode ?? false}
                    onValueChange={(value) => (storage.debugMode = value)}
                    note="Logs sanitized button metadata only. No user or session data is logged."
                />
            </View>
        </ScrollView>
    );
}
