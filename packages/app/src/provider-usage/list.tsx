import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { Button } from "@/components/ui/button";
import { ProviderUsageCard } from "./card";
import { providerUsageCopy } from "./copy";
import type { ProviderUsage } from "./types";

export function ProviderUsageList({ providers }: { providers: ProviderUsage[] }) {
  const [showUnavailable, setShowUnavailable] = useState(false);
  const visible = providers.filter((usage) => usage.status !== "unavailable");
  const unavailable = providers.filter((usage) => usage.status === "unavailable");
  const toggleUnavailable = useCallback(() => setShowUnavailable((value) => !value), []);

  return (
    <View>
      {visible.map((usage) => (
        <ProviderUsageCard key={usage.providerId} usage={usage} />
      ))}
      {unavailable.length > 0 ? (
        <View style={settingsStyles.card}>
          <Button
            variant="ghost"
            size="md"
            leftIcon={showUnavailable ? ChevronDown : ChevronRight}
            style={styles.disclosure}
            aria-expanded={showUnavailable}
            onPress={toggleUnavailable}
          >
            {`${providerUsageCopy.unavailableProviders} · ${unavailable.length}`}
          </Button>
          {showUnavailable
            ? unavailable.map((usage) => (
                <View key={usage.providerId} style={styles.unavailableRow}>
                  <ProviderUsageCard usage={usage} compact />
                </View>
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  disclosure: {
    justifyContent: "flex-start",
  },
  unavailableRow: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    padding: theme.spacing[4],
  },
}));
