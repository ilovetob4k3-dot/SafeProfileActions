import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

const { ScrollView, Text, View } = ReactNative;
const { FormSection, FormSwitchRow } = Forms;

export default function Settings() {
    useProxy(storage);

    return (
        <ScrollView>
            <View>
                <FormSection title="Add Friend">
                    <FormSwitchRow
                        label="Block Add Friends"
                        value={storage.blockAddFriends ?? true}
                        onValueChange={(value) => (storage.blockAddFriends = Boolean(value))}
                    />
                    <FormSwitchRow
                        label="Show Add Friend Block Toast"
                        value={storage.showBlockToast ?? false}
                        onValueChange={(value) => (storage.showBlockToast = Boolean(value))}
                        note='Shows "oops lol" when Add Friend is blocked.'
                    />
                </FormSection>
                <FormSection title="Calls">
                    {Text ? (
                        <Text>
                            Hide Call Buttons source is not included in this repo/context yet, so no call-button
                            toggles are enabled.
                        </Text>
                    ) : null}
                </FormSection>
                <FormSection title="Typing">
                    <FormSwitchRow
                        label="Hide Typing Indicator"
                        value={storage.noTyping ?? false}
                        onValueChange={(value) => (storage.noTyping = Boolean(value))}
                    />
                </FormSection>
                <FormSection title="Reactions">
                    <FormSwitchRow
                        label="Confirm React"
                        value={storage.confirmReact ?? true}
                        onValueChange={(value) => (storage.confirmReact = Boolean(value))}
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
