import { describe, expect, it } from "vitest";
import {
  buildProjectOptionId,
  type ScheduleProjectTarget,
} from "@/schedules/schedule-project-targets";
import { openRadarForm, type RadarFormRecord, type RadarFormSubmission } from "./form-model";

function makeTarget(overrides: Partial<ScheduleProjectTarget> = {}): ScheduleProjectTarget {
  const serverId = overrides.serverId ?? "host-a";
  const projectViewKey = overrides.projectViewKey ?? "gravity";
  return {
    optionId: buildProjectOptionId(serverId, projectViewKey),
    serverId,
    serverName: "Host A",
    projectViewKey,
    projectName: "Gravity",
    cwd: "/repos/gravity",
    isGit: true,
    ...overrides,
  };
}

const GRAVITY = makeTarget();
const DOCS = makeTarget({ projectViewKey: "docs", projectName: "Docs", cwd: "/repos/docs" });
const OTHER_HOST = makeTarget({ serverId: "host-b", projectName: "Elsewhere", cwd: "/srv/else" });

const STORED: RadarFormRecord = {
  id: "radar-1",
  channel: "alerts",
  cwd: "/repos/gravity",
  provider: "claude",
  instructions: "Ignore deploy notifications",
};

const MODELS = [
  { id: "model-fast", label: "Fast" },
  { id: "model-deep", label: "Deep" },
];

function openCreate(targets: readonly ScheduleProjectTarget[] = [GRAVITY, DOCS, OTHER_HOST]) {
  return openRadarForm({ serverId: "host-a", radar: null, projectTargets: targets });
}

function openEdit(
  radar: RadarFormRecord = STORED,
  targets: readonly ScheduleProjectTarget[] = [GRAVITY, DOCS],
) {
  return openRadarForm({ serverId: "host-a", radar, projectTargets: targets });
}

async function captureSubmission(
  form: ReturnType<typeof openRadarForm>,
): Promise<RadarFormSubmission | null> {
  let captured: RadarFormSubmission | null = null;
  await form.submit(async (submission) => {
    captured = submission;
  });
  return captured;
}

describe("radar form: create", () => {
  it("opens empty and offers only the pinned host's projects", () => {
    const state = openCreate().getState();

    expect(state.mode).toBe("create");
    expect(state.projectOptions.map((option) => option.label)).toEqual(["Gravity", "Docs"]);
    expect(state.projectDisplay).toBeNull();
    expect(state.channel).toBe("");
    expect(state.isChannelInvalid).toBe(false);
    expect(state.canSubmit).toBe(false);
  });

  it("needs both a project and a channel before it can submit", () => {
    const form = openCreate();

    form.setChannel("#alerts");
    expect(form.getState().canSubmit).toBe(false);

    form.setProject(GRAVITY.optionId, { label: "Gravity" });
    expect(form.getState().canSubmit).toBe(true);

    form.setChannel("   ");
    expect(form.getState().canSubmit).toBe(false);
    expect(form.getState().isChannelInvalid).toBe(false);
  });

  it.each([
    ["#alerts", "alerts"],
    ["  alerts ", "alerts"],
    ["C0123ABCD", "C0123ABCD"],
    ["https://acme.slack.com/archives/C0123ABCD", "C0123ABCD"],
    ["https://acme.slack.com/archives/C0123ABCD/p1700000000000100", "C0123ABCD"],
  ])("submits %s as channel %s", async (typed, channel) => {
    const form = openCreate();
    form.setProject(GRAVITY.optionId, { label: "Gravity" });
    form.setChannel(typed);

    expect(await captureSubmission(form)).toEqual({
      kind: "create",
      input: { channel, cwd: "/repos/gravity" },
    });
  });

  it.each(["https://app.slack.com/client/T01/C0123ABCD", "prod alerts"])(
    "flags %s as not a channel and refuses to submit it",
    async (typed) => {
      const form = openCreate();
      form.setProject(GRAVITY.optionId, { label: "Gravity" });
      form.setChannel(typed);

      expect(form.getState().isChannelInvalid).toBe(true);
      expect(form.getState().canSubmit).toBe(false);
      expect(await captureSubmission(form)).toBeNull();
    },
  );

  it("sends trimmed instructions and omits blank ones", async () => {
    const form = openCreate();
    form.setProject(DOCS.optionId, { label: "Docs" });
    form.setChannel("alerts");

    form.setInstructions("  Ignore deploy notifications \n");
    expect(await captureSubmission(form)).toEqual({
      kind: "create",
      input: {
        channel: "alerts",
        cwd: "/repos/docs",
        instructions: "Ignore deploy notifications",
      },
    });

    form.setInstructions("   ");
    expect(await captureSubmission(form)).toEqual({
      kind: "create",
      input: { channel: "alerts", cwd: "/repos/docs" },
    });
  });

  it("ignores a project from another host", () => {
    const form = openCreate([GRAVITY]);

    form.setProject(OTHER_HOST.optionId, { label: "Elsewhere" });

    expect(form.getState().cwd).toBe("");
    expect(form.getState().projectDisplay).toBeNull();
  });
});

describe("radar form: edit", () => {
  it("seeds every value and display from the stored radar", () => {
    const state = openEdit().getState();

    expect(state.mode).toBe("edit");
    expect(state.channel).toBe("#alerts");
    expect(state.cwd).toBe("/repos/gravity");
    expect(state.selectedProjectOptionId).toBe(GRAVITY.optionId);
    expect(state.projectDisplay).toEqual({ label: "Gravity" });
    expect(state.instructions).toBe("Ignore deploy notifications");
    expect(state.canSubmit).toBe(true);
  });

  it("submits nothing but the radar id when nothing changed", async () => {
    expect(await captureSubmission(openEdit())).toEqual({
      kind: "update",
      input: { radarId: "radar-1" },
    });
  });

  it("submits only the fields that changed", async () => {
    const form = openEdit();

    form.setChannel("https://acme.slack.com/archives/C0999ZZZZ");
    expect(await captureSubmission(form)).toEqual({
      kind: "update",
      input: { radarId: "radar-1", channel: "C0999ZZZZ" },
    });

    form.setProject(DOCS.optionId, { label: "Docs" });
    form.setChannel("#alerts");
    expect(await captureSubmission(form)).toEqual({
      kind: "update",
      input: { radarId: "radar-1", cwd: "/repos/docs" },
    });
  });

  it("clears instructions with null", async () => {
    const form = openEdit();

    form.setInstructions("");

    expect(await captureSubmission(form)).toEqual({
      kind: "update",
      input: { radarId: "radar-1", instructions: null },
    });
  });

  it("shows a stored path until its project arrives, then names it", () => {
    const form = openEdit(STORED, []);
    expect(form.getState().projectDisplay).toEqual({ label: "/repos/gravity" });
    expect(form.getState().selectedProjectOptionId).toBeNull();

    form.applyProjectTargets([GRAVITY, DOCS]);

    expect(form.getState().projectDisplay).toEqual({ label: "Gravity" });
    expect(form.getState().selectedProjectOptionId).toBe(GRAVITY.optionId);
    expect(form.getState().projectOptions).toHaveLength(2);
  });
});

describe("radar form: model", () => {
  it("runs on the default model until one is picked, and sends none", async () => {
    const form = openCreate();
    form.setProject(GRAVITY.optionId, { label: "Gravity" });
    form.setChannel("#alerts");
    form.applyModels(MODELS);

    expect(form.getState().selectedModel).toBeNull();
    expect(form.getState().modelOptions.map((option) => option.label)).toEqual(["Fast", "Deep"]);
    expect(await captureSubmission(form)).toEqual({
      kind: "create",
      input: { channel: "alerts", cwd: "/repos/gravity" },
    });
  });

  it("sends the picked model on create", async () => {
    const form = openCreate();
    form.setProject(GRAVITY.optionId, { label: "Gravity" });
    form.setChannel("#alerts");
    form.applyModels(MODELS);
    form.setModel("model-deep", { label: "Deep" });

    expect(form.getState().modelDisplay).toEqual({ label: "Deep" });
    expect(await captureSubmission(form)).toEqual({
      kind: "create",
      input: { channel: "alerts", cwd: "/repos/gravity", model: "model-deep" },
    });
  });

  it("shows a stored model as its id until the host names it", () => {
    const form = openEdit({ ...STORED, model: "model-deep" });
    expect(form.getState().modelDisplay).toEqual({ label: "model-deep" });

    form.applyModels(MODELS);

    expect(form.getState().selectedModel).toBe("model-deep");
    expect(form.getState().modelDisplay).toEqual({ label: "Deep" });
  });

  it("keeps a stored model the host no longer lists", async () => {
    const form = openEdit({ ...STORED, model: "model-retired" });
    form.applyModels(MODELS);

    expect(form.getState().modelDisplay).toEqual({ label: "model-retired" });
    expect(await captureSubmission(form)).toEqual({
      kind: "update",
      input: { radarId: "radar-1" },
    });
  });

  it("submits a changed model alone, and null to go back to the default", async () => {
    const form = openEdit({ ...STORED, model: "model-deep" });
    form.applyModels(MODELS);

    form.setModel("model-fast", { label: "Fast" });
    expect(await captureSubmission(form)).toEqual({
      kind: "update",
      input: { radarId: "radar-1", model: "model-fast" },
    });

    form.setModel(null, null);
    expect(form.getState().modelDisplay).toBeNull();
    expect(await captureSubmission(form)).toEqual({
      kind: "update",
      input: { radarId: "radar-1", model: null },
    });
  });
});

describe("radar form: isolation", () => {
  const PLAIN_FOLDER = makeTarget({
    projectViewKey: "notes",
    projectName: "Notes",
    cwd: "/notes",
    isGit: false,
  });

  it("runs in the project workspace by default and sends no isolation", async () => {
    const form = openCreate();
    form.setProject(GRAVITY.optionId, { label: "Gravity" });
    form.setChannel("#alerts");

    expect(form.getState().isolation).toBe("local");
    expect(await captureSubmission(form)).toEqual({
      kind: "create",
      input: { channel: "alerts", cwd: "/repos/gravity" },
    });
  });

  it("sends worktree isolation on create when picked", async () => {
    const form = openCreate();
    form.setProject(GRAVITY.optionId, { label: "Gravity" });
    form.setChannel("#alerts");
    form.setIsolation("worktree");

    expect(await captureSubmission(form)).toEqual({
      kind: "create",
      input: { channel: "alerts", cwd: "/repos/gravity", isolation: "worktree" },
    });
  });

  it("a folder that is not a git checkout only runs in place", () => {
    const form = openCreate([GRAVITY, PLAIN_FOLDER]);
    form.setProject(GRAVITY.optionId, { label: "Gravity" });
    form.setIsolation("worktree");

    form.setProject(PLAIN_FOLDER.optionId, { label: "Notes" });
    expect(form.getState()).toMatchObject({ isolation: "local", canUseWorktree: false });

    form.setIsolation("worktree");
    expect(form.getState().isolation).toBe("local");
  });

  it("seeds a stored isolation and submits it only when it changes", async () => {
    const form = openEdit({ ...STORED, isolation: "worktree" });
    expect(form.getState().isolation).toBe("worktree");
    expect(await captureSubmission(form)).toEqual({
      kind: "update",
      input: { radarId: "radar-1" },
    });

    form.setIsolation("local");
    expect(await captureSubmission(form)).toEqual({
      kind: "update",
      input: { radarId: "radar-1", isolation: "local" },
    });
  });
});

describe("radar form: live data and submission", () => {
  it("keeps the user's project and its captured label when the project list churns", () => {
    const form = openCreate();
    form.setProject(DOCS.optionId, { label: "Docs" });
    form.setChannel("alerts");

    form.applyProjectTargets([makeTarget({ projectName: "Gravity renamed" })]);

    expect(form.getState().projectDisplay).toEqual({ label: "Docs" });
    expect(form.getState().cwd).toBe("/repos/docs");
    expect(form.getState().channel).toBe("alerts");
    expect(form.getState().projectOptions.map((option) => option.label)).toEqual([
      "Gravity renamed",
    ]);
  });

  it("keeps the daemon's error visible and lets the user retry", async () => {
    const form = openCreate();
    form.setProject(GRAVITY.optionId, { label: "Gravity" });
    form.setChannel("alerts");

    await form.submit(async () => {
      throw new Error("A radar already watches #alerts");
    });

    expect(form.getState().submitError).toBe("A radar already watches #alerts");
    expect(form.getState().pending).toBe(false);
    expect(form.getState().canSubmit).toBe(true);

    await form.submit(async () => {});
    expect(form.getState().submitError).toBeNull();
  });

  it("does not submit twice while a save is in flight", async () => {
    const form = openCreate();
    form.setProject(GRAVITY.optionId, { label: "Gravity" });
    form.setChannel("alerts");
    let attempts = 0;
    let release: () => void = () => {};
    const save = () => {
      attempts += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };

    const first = form.submit(save);
    expect(form.getState().pending).toBe(true);
    expect(form.getState().canSubmit).toBe(false);
    await form.submit(save);
    release();
    await first;

    expect(attempts).toBe(1);
    expect(form.getState().pending).toBe(false);
  });

  it("goes quiet after close", () => {
    const form = openCreate();
    let notifications = 0;
    form.subscribe(() => {
      notifications += 1;
    });

    form.close();
    form.setChannel("alerts");

    expect(notifications).toBe(0);
    expect(form.getState().channel).toBe("");
  });
});
