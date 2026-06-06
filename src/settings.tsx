import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

const { ScrollView, View } = ReactNative;
const { FormSection, FormSwitchRow } = Forms;

export default function Settings() {
    useProxy(storage);

    return (
        <ScrollView>
            <View>
                <FormSection title="Add Friend">
                    <FormSwitchRow
                        label="Show Add Friend Block Toast"
                        value={storage.showBlockToast ?? false}
                        onValueChange={(value) => (storage.showBlockToast = Boolean(value))}
                        note='Shows "oops lol" when Add Friend is blocked.'
                    />
                </FormSection>
                <FormSection title="Reactions">
                    <FormSwitchRow
                        label="Confirm Reactions"
                        value={storage.confirmReactions ?? true}
                        onValueChange={(value) => (storage.confirmReactions = Boolean(value))}
                    />
                    <FormSwitchRow
                        label="Double Confirm Reactions"
                        value={storage.doubleConfirmReactions ?? true}
                        onValueChange={(value) => (storage.doubleConfirmReactions = Boolean(value))}
                    />
                    <FormSwitchRow
                        label="Show Emoji In Prompt"
                        value={storage.showEmojiInPrompt ?? false}
                        onValueChange={(value) => (storage.showEmojiInPrompt = Boolean(value))}
                    />
                </FormSection>
            </View>
        </ScrollView>
    );
}
