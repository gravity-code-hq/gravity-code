import type { GestureResponderEvent } from "react-native";
import { FolderGit2, Play } from "lucide-react-native";
import { useCallback, type ReactElement } from "react";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import {
  filterWorkspaceProjectsForHost,
  type HostProjectListItem,
} from "@/projects/host-project-model";
import { useHostProjects } from "@/projects/host-projects";
import type { Theme } from "@/styles/theme";

const ThemedFolderGit2 = withUnistyles(FolderGit2);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ICON_SIZE = 14;

const repoLeading = <ThemedFolderGit2 size={ICON_SIZE} uniProps={mutedColorMapping} />;

/**
 * What a start needs from the user: the repo. The workspace is always a new
 * worktree cut from it; a repo that is not a git checkout attaches to its
 * directory instead. `project` is null only when the host has no projects, in
 * which case the caller opens the New workspace screen so one can be added.
 */
export interface LinearStartChoice {
  project: HostProjectListItem | null;
}

/** The repos on this host a Linear start can target, sorted by name. */
export function useLinearStartProjects(serverId: string): HostProjectListItem[] {
  const serverIds = useMemo(() => [serverId], [serverId]);
  const projects = useHostProjects(serverIds);
  return useMemo(
    () =>
      filterWorkspaceProjectsForHost({ projects, serverId, allowAllProjects: true }).sort((a, b) =>
        a.projectName.localeCompare(b.projectName, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      ),
    [projects, serverId],
  );
}

function RepoMenuItem({
  project,
  onStart,
  testID,
}: {
  project: HostProjectListItem;
  onStart: (choice: LinearStartChoice) => void;
  testID: string;
}): ReactElement {
  const handleSelect = useCallback(() => onStart({ project }), [onStart, project]);
  return (
    <DropdownMenuItem leading={repoLeading} onSelect={handleSelect} testID={testID}>
      {project.projectName}
    </DropdownMenuItem>
  );
}

/** A page listing the repos on this host. The row kebab pushes it behind "Start agent". */
export function buildLinearRepoPage(input: {
  id: string;
  title: string;
  projects: HostProjectListItem[];
  onStart: (choice: LinearStartChoice) => void;
  testIDPrefix: string;
}): MenuPageDefinition {
  return {
    id: input.id,
    title: input.title,
    content: (
      <RepoItems
        projects={input.projects}
        onStart={input.onStart}
        testIDPrefix={input.testIDPrefix}
      />
    ),
  };
}

function RepoItems({
  projects,
  onStart,
  testIDPrefix,
}: {
  projects: HostProjectListItem[];
  onStart: (choice: LinearStartChoice) => void;
  testIDPrefix: string;
}): ReactElement {
  if (projects.length === 0) {
    return <NoProjectsItems onStart={onStart} testIDPrefix={testIDPrefix} />;
  }
  return (
    <>
      {projects.map((project) => (
        <RepoMenuItem
          key={project.viewKey}
          project={project}
          onStart={onStart}
          testID={`${testIDPrefix}-${project.viewKey}`}
        />
      ))}
    </>
  );
}

function NoProjectsItems({
  onStart,
  testIDPrefix,
}: {
  onStart: (choice: LinearStartChoice) => void;
  testIDPrefix: string;
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onStart({ project: null }), [onStart]);
  return (
    <>
      <DropdownMenuLabel>{t("linear.issue.noProjects")}</DropdownMenuLabel>
      <DropdownMenuItem onSelect={handleSelect} testID={`${testIDPrefix}-composer`}>
        {t("linear.issue.openComposer")}
      </DropdownMenuItem>
    </>
  );
}

interface LinearStartAgentButtonProps {
  identifier: string;
  isStarting: boolean;
  compact?: boolean;
  onStart: () => void;
}

export function LinearStartAgentButton({
  identifier,
  isStarting,
  compact = false,
  onStart,
}: LinearStartAgentButtonProps): ReactElement {
  const { t } = useTranslation();
  const label = t("linear.issue.startAgent");
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onStart();
    },
    [onStart],
  );
  return (
    <Button
      variant="outline"
      size="sm"
      leftIcon={Play}
      loading={isStarting}
      disabled={isStarting}
      onPress={handlePress}
      accessibilityLabel={`${label}: ${identifier}`}
      testID={`linear-issue-start-agent-${identifier}`}
    >
      {compact ? null : label}
    </Button>
  );
}
