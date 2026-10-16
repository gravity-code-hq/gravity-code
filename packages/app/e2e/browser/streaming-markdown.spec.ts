import { test } from "../support/fixtures";
import { expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  expectFinishedMarkdown,
  expectReloadedMarkdown,
  expectUnfinishedBold,
  expectUnfinishedLink,
  requestStreamingMarkdown,
  withStreamingMarkdown,
} from "../support/helpers/streaming-markdown";

test("formats unfinished Markdown while streaming and preserves the completed rendering", async ({
  page,
}, testInfo) => {
  await withStreamingMarkdown(page, testInfo, async (agent) => {
    await requestStreamingMarkdown(agent);
    await expectUnfinishedBold(page);
    await expectUnfinishedLink(page, agent, testInfo);
    await expectFinishedMarkdown(page, agent, testInfo);
    await expectReloadedMarkdown(page);
  });
});

const VISUALIZATION_HTML = `
<div class="viz-carousel">
  <section data-variant="Effort meter"><i data-lucide="brain"></i><button id="level">High</button></section>
  <section data-variant="Minimal" hidden><p>Minimal preview</p></section>
</div>
<script>
document.querySelector('#level').onclick = event => {
  event.currentTarget.textContent = 'Low';
  window.openai.setWidgetState({ modelContent: { level: 'Low' } });
};
try { parent.document.body.dataset.visualizationEscaped = 'true'; } catch {}
</script>`;

test("renders a streamed visualization inline with icons, interactions, carousel, and history reload", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(tmpdir(), "gravity-visualization-"));
  const file = path.join(directory, "effort.html");
  await writeFile(file, VISUALIZATION_HTML);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "visualization-stream-",
    title: "Visualization",
    featureValues: {
      mockStreamingAssistantResponse: `Before preview\n\n\uE200visualize\uE202${JSON.stringify({ path: file })}\uE201\n\nAfter preview`,
      mockStreamingAssistantIntervalMs: 20,
    },
  });
  try {
    await openAgentRoute(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Show the preview");
    const frame = page.getByTestId("visualization-frame").contentFrame();
    await expect(frame.getByRole("button", { name: "High", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(frame.locator("svg")).toHaveCount(1);
    await expect
      .poll(async () => (await page.getByTestId("visualization-preview").boundingBox())?.height)
      .toBeLessThan(200);
    await expect(
      page.getByTestId("assistant-message").filter({ hasText: "After preview" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("assistant-message").filter({ hasText: "\uE200visualize" }),
    ).toHaveCount(0);
    await frame.getByRole("button", { name: "High", exact: true }).click();
    await expect(frame.getByRole("button", { name: "Low", exact: true })).toBeVisible();
    await frame.getByRole("button", { name: "Next variant" }).click();
    await expect(frame.getByText("Minimal preview")).toBeVisible();
    await frame.getByRole("button", { name: "Previous variant" }).click();
    await expect(frame.getByRole("button", { name: "Low", exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toHaveAttribute("data-visualization-escaped", "true");
    await page
      .getByTestId("visualization-preview")
      .screenshot({ path: testInfo.outputPath("visualization.png") });
    await page.reload();
    await expect(frame.getByRole("button", { name: "High", exact: true })).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await agent.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});

test("shows a failed visualization read and retries after the file becomes available", async ({
  page,
}) => {
  const directory = await mkdtemp(path.join(tmpdir(), "gravity-visualization-retry-"));
  const file = path.join(directory, "missing.html");
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "visualization-retry-",
    title: "Missing visualization",
    featureValues: {
      mockStreamingAssistantResponse: `\uE200visualize\uE202${JSON.stringify({ path: file })}\uE201`,
    },
  });
  try {
    await openAgentRoute(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Show the preview");
    const failure = page.getByTestId("visualization-error");
    await expect(failure).toBeVisible({ timeout: 30_000 });
    await expect(failure.getByRole("button", { name: "Retry" })).toBeEnabled();
    await writeFile(file, VISUALIZATION_HTML);
    await failure.getByRole("button", { name: "Retry" }).click();
    await expect(
      page
        .getByTestId("visualization-frame")
        .contentFrame()
        .getByRole("button", { name: "High", exact: true }),
    ).toBeVisible();
    await expect(failure).toHaveCount(0);
  } finally {
    await agent.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});
