import { ReactNative } from "@vendetta/metro/common";
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
                <FormSection title="Calls / User Profile">
                    <FormSwitchRow
                        label="Hide profile voice call button"
                        value={storage.upHideVoiceButton ?? true}
                        onValueChange={(value) => (storage.upHideVoiceButton = Boolean(value))}
                    />
                    <FormSwitchRow
                        label="Hide profile video call button"
                        value={storage.upHideVideoButton ?? true}
                        onValueChange={(value) => (storage.upHideVideoButton = Boolean(value))}
                    />
                </FormSection>
                <FormSection title="Calls / DMs">
                    <FormSwitchRow
                        label="Hide DM voice call button"
                        value={storage.dmHideCallButton ?? false}
                        onValueChange={(value) => (storage.dmHideCallButton = Boolean(value))}
                    />
                    <FormSwitchRow
                        label="Hide DM video call button"
                        value={storage.dmHideVideoButton ?? false}
                        onValueChange={(value) => (storage.dmHideVideoButton = Boolean(value))}
                    />
                </FormSection>
                <FormSection title="Calls / Voice Chat">
                    <FormSwitchRow
                        label="Hide VC video button"
                        value={storage.hideVCVideoButton ?? false}
                        onValueChange={(value) => (storage.hideVCVideoButton = Boolean(value))}
                    />
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
