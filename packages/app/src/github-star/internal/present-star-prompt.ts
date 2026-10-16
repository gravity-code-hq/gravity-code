import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { hostSupportsFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { resolveAppVersion } from "@/utils/app-version";
import { isStarPromptDue } from "./star-prompt-policy";
import { type StarPromptSource, useStarPromptStore } from "./star-prompt-store";

interface StarCapableHost {
  serverId: string;
  client: DaemonClient;
}

// Asking the host takes up to 15s; a second trigger during that window must not
// start another check or stack a second prompt.
let evaluating = false;

function findStarCapableHost(): StarCapableHost | null {
  const runtime = getHostRuntimeStore();
  for (const [serverId, session] of Object.entries(useSessionStore.getState().sessions)) {
    if (!hostSupportsFeature(session?.serverInfo, "githubRepoStar")) {
      continue;
    }
    const snapshot = runtime.getSnapshot(serverId);
    if (snapshot?.client && isHostRuntimeConnected(snapshot)) {
      return { serverId, client: snapshot.client };
    }
  }
  return null;
}

async function readStarred(host: StarCapableHost | null): Promise<boolean | null> {
  if (!host) {
    return null;
  }
  try {
    return (await host.client.getGitHubRepoStarStatus()).starred;
  } catch {
    return null;
  }
}

/**
 * Checks whether a connected host has already starred Gravity, then opens the
 * prompt in the mode that host can support. A host that already starred ends
 * the automatic ask without showing anything.
 */
export async function presentStarPrompt(source: StarPromptSource): Promise<void> {
  if (evaluating || useStarPromptStore.getState().prompt) {
    return;
  }
  evaluating = true;
  try {
    useStarPromptStore.getState().syncVersion(resolveAppVersion());
    if (
      source === "schedule" &&
      !isStarPromptDue(useStarPromptStore.getState().schedule, Date.now())
    ) {
      return;
    }
    const host = findStarCapableHost();
    const starred = await readStarred(host);
    const store = useStarPromptStore.getState();
    if (store.prompt) {
      return;
    }
    if (starred === true) {
      store.complete();
      if (source === "manual") {
        store.showPrompt({
          source,
          mode: "gh",
          serverId: host?.serverId ?? null,
          alreadyStarred: true,
        });
      }
      return;
    }
    if (source === "schedule" && !isStarPromptDue(store.schedule, Date.now())) {
      return;
    }
    store.showPrompt({
      source,
      mode: starred === false && host ? "gh" : "web",
      serverId: starred === false && host ? host.serverId : null,
      alreadyStarred: false,
    });
  } finally {
    evaluating = false;
  }
}
