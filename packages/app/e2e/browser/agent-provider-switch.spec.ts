import { expect, test } from "../support/fixtures";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import {
  drillIntoProvider,
  openModelPicker,
  seedModelProvider,
} from "../support/helpers/agent-profiles";
import { expectForkHistoryPreview, observeForkAttachment } from "../support/helpers/assistant-fork";
import { expectComposerVisible } from "../support/helpers/composer";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";

// A second runnable provider so the live agent's picker has somewhere to switch to.
const STUDIO = {
  id: "mock-studio",
  label: "Mock Studio",
  models: [{ id: "studio-deep", label: "Studio deep think", description: "Studio long pass" }],
};

async function readSourceAgent(session: MockAgentWorkspace) {
  const agents = await session.client.fetchAgents({ scope: "active" });
  return agents.entries.find(({ agent }) => agent.id === session.agentId)?.agent;
}

function backButton(page: Parameters<typeof openModelPicker>[0]) {
  return page.getByRole("dialog").getByRole("button", { name: "Back", exact: true });
}

function selectedWorkspaceTab(page: Parameters<typeof openModelPicker>[0]) {
  return page
    .getByTestId("workspace-tabs-row")
    .getByRole("button")
    .and(page.locator('[aria-selected="true"]'));
}

test.describe("Switching a live agent to another provider", () => {
  test.describe.configure({ timeout: 180_000 });

  test("picking another provider's model forks the history into a draft on that provider", async ({
    page,
  }) => {
    const forkAttachment = observeForkAttachment(page);
    const provider = await seedModelProvider(STUDIO);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "agent-provider-switch-",
      title: "Provider switch source",
      initialPrompt: "emit 1 coalesced agent stream updates for the provider switch.",
      model: "ten-second-stream",
    });

    try {
      await openAgentRoute(page, session);
      await expectComposerVisible(page);
      await awaitAssistantMessage(page);
      await session.client.waitForFinish(session.agentId, 45_000);

      await test.step("the live picker opens on the agent's provider with the others behind Back", async () => {
        await openModelPicker(page);
        await expect(page.getByTestId("model-row-mock-ten-second-stream")).toBeVisible({
          timeout: 30_000,
        });
        await backButton(page).click();
        await drillIntoProvider(page, STUDIO.id);
      });

      await test.step("picking the other provider's model opens a draft carrying the history", async () => {
        await page.getByTestId(`model-row-${STUDIO.id}-studio-deep`).click();
        await expect(
          page.getByText("Continuing in Mock Studio in a new tab with the chat history"),
        ).toBeVisible({ timeout: 30_000 });
        await expect(selectedWorkspaceTab(page)).toHaveAttribute(
          "data-testid",
          /^workspace-tab-draft_/,
          { timeout: 30_000 },
        );
        await expectForkHistoryPreview(page);
        expect(await forkAttachment.waitForText()).toContain("<chat-history-summary>");
        await expect(
          page
            .getByRole("button", { name: "Select model (Studio deep think)", exact: true })
            .filter({ visible: true }),
        ).toBeVisible({ timeout: 30_000 });
      });

      await test.step("the source agent keeps its own provider and model", async () => {
        const source = await readSourceAgent(session);
        expect(source?.provider).toBe("mock");
        expect(source?.model).toBe("ten-second-stream");
      });
    } finally {
      await session.cleanup();
      await provider.restore();
    }
  });

  test("picking a model from the agent's own provider changes it in place", async ({ page }) => {
    const provider = await seedModelProvider(STUDIO);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "agent-provider-switch-same-",
      title: "Provider switch same provider",
      model: "ten-second-stream",
    });

    try {
      await openAgentRoute(page, session);
      await expectComposerVisible(page);

      await openModelPicker(page);
      await page.getByTestId("model-row-mock-five-minute-stream").click();

      await expect(
        page
          .getByRole("button", { name: "Select model (Five minute stream)", exact: true })
          .filter({ visible: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(selectedWorkspaceTab(page)).toHaveAttribute(
        "data-testid",
        `workspace-tab-agent_${session.agentId}`,
      );
      await expect
        .poll(async () => (await readSourceAgent(session))?.model)
        .toBe("five-minute-stream");
    } finally {
      await session.cleanup();
      await provider.restore();
    }
  });
});
