import { ChevronDown, Users } from "lucide-react-native";
import { useCallback, type ReactElement } from "react";
import { Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { LinearTeam } from "@gravity/protocol/linear/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/styles/theme";

const ThemedUsers = withUnistyles(Users);
const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface LinearTeamFilterProps {
  teams: LinearTeam[];
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string | null) => void;
}

/** The "All teams / <team>" filter pill beside the status filter; same chrome as HostFilter. */
export function LinearTeamFilter({
  teams,
  selectedTeamId,
  onSelectTeam,
}: LinearTeamFilterProps): ReactElement {
  const { t } = useTranslation();
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const label = selectedTeam?.name ?? t("linear.filters.allTeams");
  const selectAll = useCallback(() => onSelectTeam(null), [onSelectTeam]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("linear.filters.teamFilterLabel", { team: label })}
        testID="linear-team-filter-trigger"
      >
        <ThemedUsers size={14} uniProps={mutedColorMapping} />
        <Text style={styles.triggerText} numberOfLines={1}>
          {label}
        </Text>
        <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={240}>
        <DropdownMenuItem
          selected={selectedTeamId === null}
          showSelectedCheck
          onSelect={selectAll}
          testID="linear-team-filter-all"
        >
          {t("linear.filters.allTeams")}
        </DropdownMenuItem>
        {teams.map((team) => (
          <LinearTeamFilterItem
            key={team.id}
            team={team}
            selected={team.id === selectedTeamId}
            onSelectTeam={onSelectTeam}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LinearTeamFilterItem({
  team,
  selected,
  onSelectTeam,
}: {
  team: LinearTeam;
  selected: boolean;
  onSelectTeam: (teamId: string) => void;
}): ReactElement {
  const handleSelect = useCallback(() => onSelectTeam(team.id), [onSelectTeam, team.id]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      description={team.key}
      onSelect={handleSelect}
      testID={`linear-team-filter-${team.key}`}
    >
      {team.name}
    </DropdownMenuItem>
  );
}

function triggerStyle({
  pressed,
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.trigger,
    Boolean(hovered) && styles.triggerHovered,
    pressed && styles.triggerPressed,
  ];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    alignSelf: "flex-start",
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  triggerPressed: {
    backgroundColor: theme.colors.surface3,
  },
  triggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));
