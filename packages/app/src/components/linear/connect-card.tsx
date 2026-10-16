import { useCallback, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { LinearIcon } from "@/components/icons/linear-icon";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";

const LINEAR_API_KEYS_URL = "https://linear.app/settings/account/security";

interface LinearConnectCardProps {
  onConnect: (apiKey: string) => void;
  isConnecting: boolean;
  error: string | null;
}

/**
 * The first-run surface for a host without a Linear key. The key is sent to the
 * daemon once and never read back, so the field is write-only.
 */
export function LinearConnectCard({
  onConnect,
  isConnecting,
  error,
}: LinearConnectCardProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [apiKey, setApiKey] = useState("");
  const canSubmit = apiKey.trim().length > 0 && !isConnecting;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onConnect(apiKey.trim());
  }, [apiKey, canSubmit, onConnect]);

  return (
    <View style={styles.card} testID="linear-connect-card">
      <LinearIcon size={styles.icon.width} color={styles.icon.color} />
      <View style={styles.textStack}>
        <Text style={styles.title}>{t("linear.connect.title")}</Text>
        <Text style={styles.description}>{t("linear.connect.description")}</Text>
      </View>
      <View style={styles.form}>
        <Field label={t("linear.connect.apiKeyLabel")} error={error}>
          <FormTextInput
            size={isCompact ? "md" : "sm"}
            testID="linear-api-key-input"
            accessibilityLabel={t("linear.connect.apiKeyLabel")}
            initialValue=""
            onChangeText={setApiKey}
            onSubmitEditing={handleSubmit}
            placeholder={t("linear.connect.apiKeyPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </Field>
        <Button
          variant="default"
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={isConnecting}
          testID="linear-connect-submit"
        >
          {isConnecting ? t("linear.connect.pending") : t("linear.connect.action")}
        </Button>
        <ExternalLink href={LINEAR_API_KEYS_URL} label={t("linear.connect.createKey")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    alignItems: "center",
    gap: theme.spacing[6],
    maxWidth: 420,
    width: "100%",
  },
  icon: {
    width: theme.iconSize.lg,
    color: theme.colors.foregroundMuted,
  },
  textStack: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  form: {
    width: "100%",
    gap: theme.spacing[4],
    alignItems: "stretch",
  },
}));
