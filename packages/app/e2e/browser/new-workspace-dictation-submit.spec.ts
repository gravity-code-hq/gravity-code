import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openNewWorkspaceComposer } from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

type WebSocketMessage = string | Buffer;

const TRANSCRIPT = "Keep this spoken prompt visible while creating the workspace";
const PARTIAL_TRANSCRIPT = "Keep this spoken prompt visible";
const CREATE_FAILURE = "Synthetic workspace creation failure";

function parseEnvelope(message: WebSocketMessage): {
  type?: unknown;
  message?: Record<string, unknown>;
} | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    return JSON.parse(raw) as { type?: unknown; message?: Record<string, unknown> };
  } catch {
    return null;
  }
}

function sessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const envelope = parseEnvelope(message);
  return envelope?.type === "session" && envelope.message ? envelope.message : null;
}

function sendSessionMessage(
  ws: { send(message: string): void },
  message: Record<string, unknown>,
): void {
  ws.send(JSON.stringify({ type: "session", message }));
}

function enableDictationCapability(message: WebSocketMessage): WebSocketMessage {
  const envelope = parseEnvelope(message);
  const payload = envelope?.message?.payload;
  if (
    envelope?.message?.type !== "status" ||
    !payload ||
    typeof payload !== "object" ||
    (payload as { status?: unknown }).status !== "server_info"
  ) {
    return message;
  }

  (payload as Record<string, unknown>).capabilities = {
    voice: {
      dictation: { enabled: true, reason: "" },
      voice: { enabled: false, reason: "Realtime voice is disabled in this test." },
    },
  };
  return JSON.stringify(envelope);
}

async function installSyntheticMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        return destination.stream;
      },
    });
  });
}

async function installDictationFailureHarness(page: Page) {
  let resolveAudioChunk!: () => void;
  let resolveCreateRequest!: () => void;
  const audioChunk = new Promise<void>((resolve) => {
    resolveAudioChunk = resolve;
  });
  const createRequest = new Promise<void>((resolve) => {
    resolveCreateRequest = resolve;
  });
  let failCreate: (() => void) | null = null;
  let sendPartial: ((text: string) => void) | null = null;

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const request = sessionMessage(message);
      const type = request?.type;
      const dictationId = typeof request?.dictationId === "string" ? request.dictationId : null;

      if (type === "dictation_stream_start" && dictationId) {
        sendPartial = (text) =>
          sendSessionMessage(ws, {
            type: "dictation_stream_partial",
            payload: { dictationId, text },
          });
        sendSessionMessage(ws, {
          type: "dictation_stream_ack",
          payload: { dictationId, ackSeq: -1 },
        });
        return;
      }
      if (type === "dictation_stream_cancel") {
        return;
      }
      if (type === "dictation_stream_chunk" && dictationId) {
        const seq = typeof request?.seq === "number" ? request.seq : 0;
        sendSessionMessage(ws, {
          type: "dictation_stream_ack",
          payload: { dictationId, ackSeq: seq },
        });
        if (seq === 0) sendPartial?.(PARTIAL_TRANSCRIPT);
        resolveAudioChunk();
        return;
      }
      if (type === "dictation_stream_finish" && dictationId) {
        sendSessionMessage(ws, {
          type: "dictation_stream_finish_accepted",
          payload: { dictationId, timeoutMs: 5_000 },
        });
        sendSessionMessage(ws, {
          type: "dictation_stream_final",
          payload: { dictationId, text: TRANSCRIPT },
        });
        return;
      }
      if (request && type === "workspace.create.request" && typeof request.requestId === "string") {
        const requestId = request.requestId;
        failCreate = () => {
          sendSessionMessage(ws, {
            type: "workspace.create.response",
            payload: {
              requestId,
              workspace: null,
              setupTerminalId: null,
              error: CREATE_FAILURE,
            },
          });
        };
        resolveCreateRequest();
        return;
      }

      server.send(message);
    });

    server.onMessage((message) => ws.send(enableDictationCapability(message)));
  });

  return {
    waitForAudio: () => audioChunk,
    updateTranscript: (text: string) => {
      if (!sendPartial) throw new Error("Dictation has not started");
      sendPartial(text);
    },
    waitForCreateRequest: () => createRequest,
    failWorkspaceCreation: () => {
      if (!failCreate) {
        throw new Error("Workspace creation request has not been received");
      }
      failCreate();
    },
  };
}

async function dictateAndSend(page: Page, waitForAudio: () => Promise<void>): Promise<void> {
  await page.getByRole("button", { name: "Start dictation" }).click();
  await waitForAudio();
  await expect(page.getByTestId("dictation-transcript")).toHaveText(PARTIAL_TRANSCRIPT);
  await expect(page.getByRole("button", { name: "Insert transcription and send" })).toBeEnabled();
  await page.getByRole("button", { name: "Insert transcription and send" }).click();
}

test.describe("New Workspace dictation submit", () => {
  test.describe.configure({ timeout: 240_000 });

  test("keeps the spoken prompt visible while pending and after failure", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-submit-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationFailureHarness(page);

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: seeded.projectKey,
        projectDisplayName: seeded.projectDisplayName,
      });
      await dictateAndSend(page, harness.waitForAudio);
      await harness.waitForCreateRequest();

      const composer = page.getByRole("textbox", { name: "Message agent..." });
      await expect(page.getByTestId("dictation-transcript")).toHaveCount(0);
      await expect(composer).toHaveValue(TRANSCRIPT);
      await expect(composer).not.toBeEditable();

      harness.failWorkspaceCreation();

      await expect(composer).toBeEditable();
      await expect(composer).toHaveValue(TRANSCRIPT);
      await expect(page.getByText(CREATE_FAILURE).first()).toBeVisible();
    } finally {
      await seeded.cleanup();
    }
  });
  test("double-presses Command to start and stop dictation without sending", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-hold-" });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    });
    await installSyntheticMicrophone(page);
    const harness = await installDictationFailureHarness(page);
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: seeded.projectKey,
        projectDisplayName: seeded.projectDisplayName,
      });
      const composer = page.getByRole("textbox", { name: "Message agent..." });
      await composer.focus();
      await page.keyboard.press("MetaLeft");
      await page.keyboard.press("MetaLeft");
      await harness.waitForAudio();
      await expect(page.getByTestId("dictation-transcript")).toHaveText(PARTIAL_TRANSCRIPT);
      await page.keyboard.press("MetaLeft");
      await page.keyboard.press("MetaLeft");
      await expect(page.getByTestId("dictation-transcript")).toHaveCount(0);
      await expect(composer).toHaveValue(TRANSCRIPT);
      await expect(composer).toBeEditable();
    } finally {
      await seeded.cleanup();
    }
  });

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    test(`updates the preview and preserves the draft on cancel at ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      const seeded = await seedWorkspace({ repoPrefix: "dictation-preview-" });
      await installSyntheticMicrophone(page);
      const harness = await installDictationFailureHarness(page);
      try {
        await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
        await gotoAppShell(page);
        await waitForSidebarHydration(page);
        await openNewWorkspaceComposer(page, {
          projectKey: seeded.projectKey,
          projectDisplayName: seeded.projectDisplayName,
        });
        await page.setViewportSize(viewport);
        const composer = page.getByRole("textbox", { name: "Message agent..." });
        await composer.fill("Existing draft");
        await page.getByRole("button", { name: "Start dictation" }).click();
        await harness.waitForAudio();
        const preview = page.getByTestId("dictation-transcript");
        await expect(preview).toHaveText(PARTIAL_TRANSCRIPT);
        const overlay = page.getByTestId("dictation-overlay");
        const listening = overlay.getByText("Listening", { exact: true });
        const cancel = overlay.getByRole("button", { name: "Cancel dictation" });
        await expect(listening).toBeVisible();
        const waveform = overlay.getByTestId("dictation-waveform");
        const waveformBounds = await waveform.boundingBox();
        expect(waveformBounds!.width).toBeGreaterThanOrEqual(32);
        expect(waveformBounds!.height).toBeGreaterThanOrEqual(32);
        const centerBar = waveform.getByTestId("dictation-waveform-center");
        const initialBar = await centerBar.boundingBox();
        await expect
          .poll(async () => {
            const currentBar = await centerBar.boundingBox();
            return Math.abs(currentBar!.height - initialBar!.height);
          })
          .toBeGreaterThan(1);
        await expect(async () => {
          const bounds = await overlay.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.height).toBeLessThan(160);
          const listeningBounds = await listening.boundingBox();
          const cancelBounds = await cancel.boundingBox();
          expect(listeningBounds).not.toBeNull();
          expect(cancelBounds).not.toBeNull();
          expect(cancelBounds!.x).toBeGreaterThan(listeningBounds!.x + listeningBounds!.width);
        }).toPass();
        const shortScreenshot = await page.screenshot({
          path: testInfo.outputPath("compact-dictation.png"),
        });
        await testInfo.attach("compact-dictation", {
          body: shortScreenshot,
          contentType: "image/png",
        });
        const revisedTranscript =
          "Show the words as I speak so I can check the transcription before sending. ".repeat(8);
        harness.updateTranscript(revisedTranscript);
        await expect(preview).toHaveText(revisedTranscript);
        await expect(
          page.getByRole("button", { name: "Insert transcription and send" }),
        ).toBeInViewport();
        const screenshot = await page.screenshot({
          path: testInfo.outputPath("live-dictation.png"),
        });
        await testInfo.attach("live-dictation", { body: screenshot, contentType: "image/png" });
        await page.getByRole("button", { name: "Cancel dictation" }).click();
        await expect(preview).toHaveCount(0);
        await expect(composer).toHaveValue("Existing draft");
        await expect(composer).toBeEditable();
        harness.updateTranscript("Late result from cancelled recording");
        await expect(preview).toHaveCount(0);
        await expect(composer).toHaveValue("Existing draft");
      } finally {
        await seeded.cleanup();
      }
    });
  }
});
