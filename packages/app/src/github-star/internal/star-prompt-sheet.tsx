import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ExternalLink, Star } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { GRAVITY_GITHUB_REPO, GRAVITY_GITHUB_REPO_URL } from "@gravity/protocol/gravity-repo";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { ExternalLink as RepositoryLink } from "@/components/ui/external-link";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import { type OpenStarPrompt, type StarPromptMode, useStarPromptStore } from "./star-prompt-store";

type StarPromptStatus = "idle" | "busy" | "starred";

const ThemedStar = withUnistyles(Star);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const sheetLeadingIcon = <ThemedStar size={ICON_SIZE.md} uniProps={mutedColorMapping} />;

export function StarPromptSheet() {
  const prompt = useStarPromptStore((state) => state.prompt);
  // Keep rendering the last prompt while the sheet animates closed.
  const lastPromptRef = useRef<OpenStarPrompt | null>(null);
  if (prompt) {
    lastPromptRef.current = prompt;
  }
  const shown = prompt ?? lastPromptRef.current;
  if (!shown) {
    return null;
  }
  return <StarPromptSheetContent key={shown.id} prompt={shown} visible={prompt !== null} />;
}

function StarPromptSheetContent({ prompt, visible }: { prompt: OpenStarPrompt; visible: boolean }) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const [mode, setMode] = useState<StarPromptMode>(prompt.mode);
  const [status, setStatus] = useState<StarPromptStatus>(
    prompt.alreadyStarred ? "starred" : "idle",
  );
  const [directStarFailed, setDirectStarFailed] = useState(false);
  const busy = status === "busy";
  const scheduled = prompt.source === "schedule";
  const hostLabel = hosts.find((host) => host.serverId === prompt.serverId)?.label ?? null;

  const close = useCallback(() => {
    const store = useStarPromptStore.getState();
    // The sheet can report a close again while it animates out; act on the first one only.
    if (busy || store.prompt?.id !== prompt.id) {
      return;
    }
    // Closing a scheduled ask puts it off; closing one the user opened changes nothing.
    if (scheduled && status === "idle") {
      store.defer();
    }
    store.closePrompt();
  }, [busy, prompt.id, scheduled, status]);

  const openGitHub = useCallback(async () => {
    setStatus("busy");
    try {
      await openExternalUrl(GRAVITY_GITHUB_REPO_URL);
    } catch {
      // A browser that fails to open is recoverable; keep the prompt so the user can retry.
      setStatus("idle");
      return;
    }
    const store = useStarPromptStore.getState();
    if (scheduled) {
      store.defer();
    }
    store.closePrompt();
  }, [scheduled]);

  const starDirectly = useCallback(async () => {
    const client = prompt.serverId ? getHostRuntimeStore().getClient(prompt.serverId) : null;
    setStatus("busy");
    let success = false;
    try {
      success = client ? (await client.addGitHubRepoStar()).success : false;
    } catch {
      success = false;
    }
    if (!success) {
      // The status check said a direct star should work; when it does not, offer the browser.
      setMode("web");
      setDirectStarFailed(true);
      setStatus("idle");
      return;
    }
    useStarPromptStore.getState().complete();
    setStatus("starred");
  }, [prompt.serverId]);

  const handlePrimary = useCallback(() => {
    if (busy || status === "starred") {
      return;
    }
    void (mode === "web" ? openGitHub() : starDirectly());
  }, [busy, mode, openGitHub, starDirectly, status]);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("githubStar.title"), leading: sheetLeadingIcon }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={close}
      desktopMaxWidth={420}
      testID="github-star-prompt"
    >
      <View style={styles.body}>
        <Text style={styles.description}>
          {status === "starred" ? t("githubStar.thanks") : t("githubStar.description")}
        </Text>
        <RepositoryLink
          href={GRAVITY_GITHUB_REPO_URL}
          label={GRAVITY_GITHUB_REPO}
          testID="github-star-prompt-repository"
        />
        {status !== "starred" ? (
          <StarPromptHint mode={mode} hostLabel={hostLabel} directStarFailed={directStarFailed} />
        ) : null}
        <View style={styles.actions}>
          {status === "starred" ? (
            <Button
              variant="secondary"
              size="sm"
              style={styles.actionButton}
              onPress={close}
              testID="github-star-prompt-close"
            >
              {t("common.actions.close")}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                style={styles.actionButton}
                onPress={close}
                disabled={busy}
                testID="github-star-prompt-later"
              >
                {t("githubStar.later")}
              </Button>
              <Button
                variant="default"
                size="sm"
                style={styles.actionButton}
                leftIcon={mode === "web" ? ExternalLink : Star}
                onPress={handlePrimary}
                disabled={busy}
                testID="github-star-prompt-star"
              >
                {primaryLabel({ mode, busy, t })}
              </Button>
            </>
          )}
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

function primaryLabel(input: {
  mode: StarPromptMode;
  busy: boolean;
  t: ReturnType<typeof useTranslation>["t"];
}): string {
  if (input.mode === "web") {
    return input.busy ? input.t("githubStar.opening") : input.t("githubStar.openGitHub");
  }
  return input.busy ? input.t("githubStar.starring") : input.t("githubStar.star");
}

function StarPromptHint({
  mode,
  hostLabel,
  directStarFailed,
}: {
  mode: StarPromptMode;
  hostLabel: string | null;
  directStarFailed: boolean;
}) {
  const { t } = useTranslation();
  if (directStarFailed) {
    return <Text style={styles.hint}>{t("githubStar.directStarFailed")}</Text>;
  }
  if (mode === "gh" && hostLabel) {
    return <Text style={styles.hint}>{t("githubStar.hostHint", { host: hostLabel })}</Text>;
  }
  return null;
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  description: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
