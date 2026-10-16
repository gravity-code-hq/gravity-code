import { ChevronDown } from "lucide-react-native";
import { useCallback, useMemo, type ReactElement } from "react";
import { View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { LinearWorkflowState } from "@gravity/protocol/linear/types";
import { LinearStateBadge } from "@/components/linear/state-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const CHEVRON_SIZE = 14;

interface LinearStatePickerProps {
  state: { id: string; name: string; type: string; color: string };
  /** The issue's team workflow; an empty list renders the badge alone. */
  states: LinearWorkflowState[];
  isUpdating: boolean;
  onSelectState: (state: LinearWorkflowState) => void;
  align?: "start" | "end";
  testID?: string;
}

/**
 * The state pill as a picker: the badge plus a chevron, opening the team's
 * workflow states. Shared by the issue drawer and the list row so a status
 * change looks the same wherever it happens.
 */
export function LinearStatePicker({
  state,
  states,
  isUpdating,
  onSelectState,
  align = "start",
  testID,
}: LinearStatePickerProps): ReactElement {
  const { t } = useTranslation();
  if (states.length === 0) {
    return <LinearStateBadge state={state} />;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={triggerStyle}
        disabled={isUpdating}
        accessibilityRole="button"
        accessibilityLabel={t("linear.issue.changeState")}
        testID={testID}
      >
        <LinearStateBadge state={state} />
        {isUpdating ? (
          <LoadingSpinner size={CHEVRON_SIZE} color={styles.spinner.color} />
        ) : (
          <ThemedChevronDown size={CHEVRON_SIZE} uniProps={mutedColorMapping} />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} width={240}>
        {states.map((candidate) => (
          <LinearStateMenuItem
            key={candidate.id}
            state={candidate}
            selected={candidate.id === state.id}
            onSelectState={onSelectState}
            testID={testID ? `${testID}-${candidate.id}` : undefined}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LinearStateMenuItem({
  state,
  selected,
  onSelectState,
  testID,
}: {
  state: LinearWorkflowState;
  selected: boolean;
  onSelectState: (state: LinearWorkflowState) => void;
  testID?: string;
}): ReactElement {
  const handleSelect = useCallback(() => onSelectState(state), [onSelectState, state]);
  const leading = useMemo(
    () => <View style={[styles.stateDot, { backgroundColor: state.color }]} />,
    [state.color],
  );
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      leading={leading}
      onSelect={handleSelect}
      testID={testID}
    >
      {state.name}
    </DropdownMenuItem>
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[0.5],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  stateDot: {
    width: 10,
    height: 10,
    borderRadius: theme.borderRadius.full,
  },
}));
