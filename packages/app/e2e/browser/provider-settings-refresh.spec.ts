import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DaemonClient } from "@gravity/client/internal/daemon-client";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function openMockAgentAtMobileBreakpoint(page: Page) {
  await page.setViewportSize(MOBILE_VIEWPORT);
  const session = await seedMockAgentWorkspace({
    repoPrefix: "provider-sheet-stack-",
    title: "Provider sheet stack e2e",
  });
  await openAgentRoute(page, session);
  await expectComposerVisible(page);
  await expect(page.getByRole("button", { name: /Select model/ })).toBeVisible({
    timeout: 30_000,
  });
  return session;
}

async function openProviderSettingsFromModelSelector(page: Page) {
  await page.getByRole("button", { name: /Select model/ }).click();
  const configuration = page.getByTestId("agent-controls-model-sheet");
  await expect(configuration).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("agent-controls-model").click();

  const modelBrowser = page.getByTestId("agent-controls-model-browser-sheet");
  await expect(modelBrowser).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /Open .* settings/ }).click();
  await expect(page.getByTestId("provider-settings-sheet")).toBeVisible({ timeout: 10_000 });
}

async function expectModelBrowserVisible(page: Page) {
  await expect(page.getByTestId("agent-controls-model-browser-sheet")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: /Open .* settings/ })).toBeVisible();
}

async function closeTopSheet(page: Page) {
  const closeTarget = page.getByLabel("Close", { exact: true }).last();
  if (await closeTarget.isVisible().catch(() => false)) {
    await closeTarget.click({ force: true });
    return;
  }

  const handle = page.getByRole("slider", { name: "Bottom sheet handle" }).last();
  const handleBox = await handle.boundingBox();
  if (!handleBox) {
    throw new Error("Bottom sheet handle was not measurable");
  }
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 400, { steps: 8 });
  await page.mouse.up();
}

async function closeSheetByHeaderButton(page: Page, testId: string) {
  const sheet = page.getByTestId(testId);
  await sheet.getByLabel("Close", { exact: true }).click();
  await expect(sheet).not.toBeVisible({ timeout: 10_000 });
}

async function expectOverlayAbove(page: Page, frontTestId: string, backTestId: string) {
  const frontCoversBack = await page.evaluate(
    ({ frontTestId: frontId, backTestId: backId }) => {
      const front = document.querySelector(`[data-testid="${frontId}"]`);
      const back = document.querySelector(`[data-testid="${backId}"]`);
      if (!(front instanceof HTMLElement) || !(back instanceof HTMLElement)) return false;

      const frontRect = front.getBoundingClientRect();
      const backRect = back.getBoundingClientRect();
      const left = Math.max(frontRect.left, backRect.left);
      const right = Math.min(frontRect.right, backRect.right);
      const top = Math.max(frontRect.top, backRect.top);
      const bottom = Math.min(frontRect.bottom, backRect.bottom);
      if (left >= right || top >= bottom) return false;

      const topElement = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return topElement != null && front.contains(topElement);
    },
    { frontTestId, backTestId },
  );
  expect(frontCoversBack).toBe(true);
}

async function hasFocusWithin(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element.contains(document.activeElement));
}

async function expectProviderSettingsVisible(page: Page) {
  await expect(page.getByTestId("provider-settings-sheet")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Add model" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Diagnostic", exact: true })).toBeVisible();
}

async function exerciseProviderSettingsStack(page: Page) {
  await expectProviderSettingsVisible(page);

  await page.getByRole("button", { name: "Add model" }).click();
  await expect(page.getByTestId("add-custom-model-sheet")).toBeVisible({ timeout: 10_000 });
  await closeSheetByHeaderButton(page, "add-custom-model-sheet");
  await expect(page.getByPlaceholder("e.g. openai/gpt-5")).not.toBeVisible({ timeout: 10_000 });
  await expectProviderSettingsVisible(page);

  await page.getByRole("button", { name: "Diagnostic", exact: true }).click();
  await expect(page.getByTestId("provider-diagnostic-sheet")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Refresh diagnostic/ }).click();
  await expect(page.getByTestId("provider-diagnostic-sheet")).toBeVisible({ timeout: 10_000 });
  await closeSheetByHeaderButton(page, "provider-diagnostic-sheet");
  await expectProviderSettingsVisible(page);

  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expectProviderSettingsVisible(page);
}

test.describe("provider settings overlay stack", () => {
  test("provider settings covers the desktop model selector without closing it", async ({
    page,
  }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "provider-modal-layer-",
      title: "Provider modal layer e2e",
    });

    try {
      await openAgentRoute(page, session);
      await expectComposerVisible(page);

      await page.getByRole("button", { name: /Select model/ }).click();
      const selector = page.getByTestId("combobox-desktop-container");
      await expect(selector).toBeVisible({ timeout: 10_000 });
      const searchInput = page.getByRole("textbox", { name: /search models/i });
      await expect(searchInput).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect.poll(() => hasFocusWithin(selector)).toBe(true);

      await page.keyboard.press("Shift+?");
      const shortcuts = page.getByTestId("keyboard-shortcuts-dialog");
      await expect(shortcuts).toBeVisible({ timeout: 10_000 });
      await expect(page.getByPlaceholder("Search shortcuts")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(shortcuts).not.toBeVisible({ timeout: 10_000 });
      await expect(selector).toBeVisible();

      await page.keyboard.press("ControlOrMeta+K");
      const commandCenter = page.getByTestId("command-center-panel");
      await expect(commandCenter).toBeVisible({ timeout: 10_000 });
      await expect(commandCenter.getByTestId("command-center-input")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(commandCenter).not.toBeVisible({ timeout: 10_000 });
      await expect(selector).toBeVisible();

      await page.keyboard.press("ControlOrMeta+K");
      await expect(commandCenter).toBeVisible({ timeout: 10_000 });
      await commandCenter.getByTestId("command-center-input").fill("add project");
      await commandCenter.getByText("Add project", { exact: true }).click();
      const addProject = page.getByTestId("add-project-flow");
      await expect(addProject).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press("Escape");
      await expect(addProject).not.toBeVisible({ timeout: 10_000 });
      await expect(selector).toBeVisible();

      const settingsButton = page.getByTestId("selector-header-settings-mock");
      await settingsButton.click();

      const settings = page.getByTestId("provider-settings-sheet");
      await expect(settings).toBeVisible({ timeout: 10_000 });
      await expectOverlayAbove(page, "provider-settings-sheet", "combobox-desktop-container");

      await page.keyboard.press("Escape");
      await expect(settings).not.toBeVisible({ timeout: 10_000 });
      await expect(selector).toBeVisible();
      await expect(settingsButton).toBeFocused();
    } finally {
      await session.cleanup();
    }
  });

  test("provider settings and children close back through the model browser to configuration", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const session = await openMockAgentAtMobileBreakpoint(page);

    try {
      await openProviderSettingsFromModelSelector(page);
      await exerciseProviderSettingsStack(page);
      await closeSheetByHeaderButton(page, "provider-settings-sheet");

      await expectModelBrowserVisible(page);
      await page.getByRole("button", { name: /Open .* settings/ }).click();
      await expect(page.getByTestId("provider-settings-sheet")).toBeVisible({ timeout: 10_000 });
      await exerciseProviderSettingsStack(page);
      await closeSheetByHeaderButton(page, "provider-settings-sheet");

      await expectModelBrowserVisible(page);
      await closeTopSheet(page);
      await expect(page.getByTestId("agent-controls-model-browser-sheet")).not.toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("agent-controls-settings-list")).toBeVisible();
      await closeTopSheet(page);
    } finally {
      await session.cleanup();
    }
  });
});

const customizationTest = test.extend<{}, { customizationRoot: string }>({
  customizationRoot: [
    async ({ browserName }, provide) => {
      const root = await mkdtemp(path.join(tmpdir(), `gravity-provider-settings-${browserName}-`));
      await mkdir(path.join(root, "codex", "prompts"), { recursive: true });
      await mkdir(path.join(root, "claude", "commands"), { recursive: true });
      for (const provider of ["codex", "claude"]) {
        await mkdir(path.join(root, provider, "skills", "review-skill"), { recursive: true });
        await writeFile(
          path.join(root, provider, "skills", "review-skill", "SKILL.md"),
          "---\nname: review-skill\ndescription: Review code carefully\n---\nRead the diff and review it.\n",
        );
      }
      try {
        await provide(root);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
  e2eDaemonEnvironment: [
    async ({ customizationRoot }, provide) => {
      await provide({
        CODEX_HOME: path.join(customizationRoot, "codex"),
        CLAUDE_CONFIG_DIR: path.join(customizationRoot, "claude"),
      });
    },
    { scope: "worker" },
  ],
  e2eDaemonConfig: [
    {
      version: 1,
      agents: { providers: { codex: { enabled: false }, claude: { enabled: false } } },
    },
    { scope: "worker" },
  ],
});

customizationTest.describe("provider customization tabs", () => {
  customizationTest(
    "creates commands and keeps the prompt when a name already exists",
    async ({ page, customizationRoot }, testInfo) => {
      for (const provider of ["codex", "claude"] as const) {
        await page.setViewportSize({ width: 1280, height: 900 });
        const directory = path.join(
          customizationRoot,
          provider,
          provider === "codex" ? "prompts" : "commands",
        );
        await writeFile(path.join(directory, "taken-command.md"), "Existing prompt");
        await gotoAppShell(page);
        await openSettings(page);
        await page.getByTestId(`settings-host-section-${provider}`).click();
        await page.setViewportSize(
          provider === "claude" ? MOBILE_VIEWPORT : { width: 1280, height: 900 },
        );
        await page.getByTestId("provider-tab-commands").click();
        await page.getByRole("button", { name: "Add command", exact: true }).click();
        const sheet = page.getByTestId("create-command-sheet");
        const name = sheet.getByRole("textbox", { name: "Command name", exact: true });
        const prompt = sheet.getByRole("textbox", { name: "Prompt", exact: true });
        const save = sheet.getByRole("button", { name: "Save", exact: true });
        await expect(save).toBeDisabled();
        await name.fill("../invalid");
        await prompt.fill("Review the changes and suggest improvements.");
        await expect(save).toBeDisabled();
        await name.fill("taken-command");
        await save.click();
        await expect(
          sheet.getByText("A command with this name already exists. Choose a different name."),
        ).toBeVisible();
        await expect(prompt).toHaveValue("Review the changes and suggest improvements.");
        expect(await readFile(path.join(directory, "taken-command.md"), "utf8")).toBe(
          "Existing prompt",
        );
        await name.fill("new-command");
        await page.screenshot({ path: testInfo.outputPath(`${provider}-add-command.png`) });
        await save.click();
        await expect(sheet).not.toBeVisible();
        await expect(page.getByRole("button", { name: /new-command/ })).toBeVisible();
        expect(await readFile(path.join(directory, "new-command.md"), "utf8")).toBe(
          "Review the changes and suggest improvements.",
        );
        await page.getByRole("button", { name: "Add command", exact: true }).click();
        await expect(name).toHaveValue("");
        await expect(prompt).toHaveValue("");
        await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(sheet).not.toBeVisible();
      }
    },
  );

  customizationTest(
    "reads files without provider discovery even when a model is supplied",
    async ({ customizationRoot }) => {
      const client = await connectDaemonClient<DaemonClient>({
        clientIdPrefix: "provider-customization-files",
      });
      try {
        for (const provider of ["codex", "claude"] as const) {
          const commandDirectory = provider === "codex" ? "prompts" : "commands";
          await writeFile(
            path.join(customizationRoot, provider, commandDirectory, "local-only.md"),
            "---\ndescription: Local command\n---\nReview the diff",
          );
          const catalog = await client.listProviderCustomizations({
            provider,
            model: "unused-for-file-discovery",
          });
          expect(catalog.warnings).toEqual([]);
          expect(catalog.entries).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: provider === "codex" ? "prompts:local-only" : "local-only",
                kind: "command",
                description: "Local command",
              }),
              expect.objectContaining({ name: "review-skill", kind: "skill" }),
            ]),
          );
        }
      } finally {
        await client.close();
      }
    },
  );

  customizationTest(
    "edits commands for both providers and preserves edits on conflicts",
    async ({ page, customizationRoot }, testInfo) => {
      for (const provider of ["codex", "claude"] as const) {
        const file = path.join(
          customizationRoot,
          provider,
          provider === "codex" ? "prompts" : "commands",
          "review-command.md",
        );
        await writeFile(file, "---\ndescription: Review command\n---\nOriginal instructions\n");
        await gotoAppShell(page);
        await openSettings(page);
        await page.getByTestId(`settings-host-section-${provider}`).click();
        await page.getByTestId("provider-tab-commands").click();
        await page.getByRole("button", { name: /review-command/ }).click();
        const detail = page.getByTestId("provider-customization-detail");
        const editor = detail.getByRole("textbox", { name: "Instructions", exact: true });
        await expect(editor).toHaveValue(/Original instructions/);
        await editor.fill("Updated instructions\n");
        await detail.getByRole("button", { name: "Save", exact: true }).click();
        await expect(detail.getByText("Saved", { exact: true })).toBeVisible();
        expect(await readFile(file, "utf8")).toBe("Updated instructions\n");
        await editor.fill("My unsaved changes");
        await writeFile(file, "An external edit\n");
        await detail.getByRole("button", { name: "Save", exact: true }).click();
        await expect(detail.getByText(/This file changed on disk/)).toBeVisible();
        await expect(editor).toHaveValue("My unsaved changes");
        expect(await readFile(file, "utf8")).toBe("An external edit\n");
        await page.screenshot({ path: testInfo.outputPath(`${provider}-command-conflict.png`) });
        page.once("dialog", (dialog) => void dialog.accept());
        await detail.getByRole("button", { name: "Close", exact: true }).last().click();
        await expect(detail).not.toBeVisible();
      }
    },
  );

  customizationTest(
    "opens a skill in a separate draft with the same provider",
    async ({ page }, testInfo) => {
      await gotoAppShell(page);
      await openSettings(page);
      await page.getByTestId("settings-host-section-codex").click();
      await page.getByTestId("provider-tab-skills").click();
      await page.getByPlaceholder("Search skills").fill("review-skill");
      await page.getByRole("button", { name: /review-skill/ }).click();
      await page.getByRole("button", { name: "Improve with agent", exact: true }).click();
      await expect(page).toHaveURL(/\/new\?.*provider=codex/);
      await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toHaveValue(
        /Help me improve the skill "review-skill"/,
      );
      await page.screenshot({ path: testInfo.outputPath("skill-improvement-draft.png") });
    },
  );

  customizationTest(
    "shows underlined tabs on desktop and compact screens",
    async ({ page }, testInfo) => {
      await gotoAppShell(page);
      await openSettings(page);
      await page.getByTestId("settings-host-section-claude").click();
      await page.setViewportSize(MOBILE_VIEWPORT);
      const tabs = page.getByTestId("provider-settings-tabs");
      await tabs.getByText("Skills", { exact: true }).click();
      await page.getByPlaceholder("Search skills").fill("review-skill");
      await expect(page.getByRole("button", { name: /review-skill/ })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("compact-provider-skills.png") });
      await page.setViewportSize({ width: 1440, height: 900 });
      const skillsTab = page.getByTestId("provider-tab-skills");
      await skillsTab.click();
      await expect(skillsTab).toHaveAttribute("aria-selected", "true");
      await expect(skillsTab).toHaveCSS("border-bottom-width", "2px");
      await expect(skillsTab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(page.getByRole("button", { name: /review-skill/ })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("desktop-provider-skills.png") });
    },
  );
});
