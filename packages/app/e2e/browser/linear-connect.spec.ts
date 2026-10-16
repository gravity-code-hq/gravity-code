import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

test.describe("Linear", () => {
  let workspace: SeededWorkspace | null = null;

  test.afterEach(async () => {
    await workspace?.cleanup();
    workspace = null;
  });

  test("sidebar opens the connect card on a host without a key", async ({ page }) => {
    workspace = await seedWorkspace({ repoPrefix: "linear-connect-" });

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.getByTestId("sidebar-linear").click();

    await expect(page).toHaveURL(/\/linear$/);
    await expect(page.getByTestId("linear-connect-card")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("linear-connect-submit")).toBeDisabled();
  });

  test("a rejected key keeps the connect card with the error under the field", async ({ page }) => {
    workspace = await seedWorkspace({ repoPrefix: "linear-reject-" });

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await page.getByTestId("sidebar-linear").click();
    const card = page.getByTestId("linear-connect-card");
    await expect(card).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("linear-api-key-input").fill("lin_api_not_a_real_key");
    const submit = page.getByTestId("linear-connect-submit");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(card.getByText("Linear rejected the API key.")).toBeVisible({ timeout: 30_000 });
    await expect(card).toBeVisible();
    await expect(submit).toBeEnabled();
  });
});
