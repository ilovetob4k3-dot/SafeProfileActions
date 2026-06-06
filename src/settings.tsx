import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

const { ScrollView, View } = ReactNative;

export default function Settings() {
    useProxy(storage);

    return (
        <ScrollView>
            <View>
                <Forms.FormSwitchRow
                    label="Show block toast"
                    value={storage.showBlockToast ?? false}
                    onValueChange={(value) => (storage.showBlockToast = Boolean(value))}
                    note='Shows "oops lol" when Add Friend is blocked.'
                />
            </View>
        </ScrollView>
    );
}
