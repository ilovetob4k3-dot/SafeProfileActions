import { clipboard, React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

const { ScrollView, View } = ReactNative;
const { FormRow, FormSection, FormSwitchRow, FormText } = Forms;

function copyDiagnostic() {
    const diagnostic = String(storage.reactionDiagnosticText ?? "");
    if (!diagnostic || typeof clipboard?.setString !== "function") return;

    try {
        clipboard.setString(diagnostic);
        showToast("Reaction diagnostic copied.", getAssetIDByName("copy"));
    } catch {}
}

export default function Settings() {
    useProxy(storage);

    return (
        <ScrollView>
            <View>
                <FormSwitchRow
                    label="Show block toast"
                    value={storage.showBlockToast ?? false}
                    onValueChange={(value) => (storage.showBlockToast = Boolean(value))}
                    note='Shows "oops lol" when Add Friend is blocked.'
                />
                <FormSection title="Reaction Diagnostic">
                    <FormRow
                        label="Copy latest diagnostic"
                        onPress={copyDiagnostic}
                    />
                    <FormText selectable>
                        {String(storage.reactionDiagnosticText ?? "No diagnostic captured yet.")}
                    </FormText>
                </FormSection>
            </View>
        </ScrollView>
    );
}
