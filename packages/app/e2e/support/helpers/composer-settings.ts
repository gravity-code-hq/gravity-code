import { expect, type Page } from "@playwright/test";
import { expectNoTruncation } from "./no-truncation";

export async function expectComposerMode(page: Page, label: string): Promise<void> {
  const settings = page.getByTestId("agent-controls-settings").filter({ visible: true }).first();
  await settings.click();
  await expect(page.getByTestId("agent-settings-permissions")).toContainText(label);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveAttribute("aria-expanded", "false");
}

export async function selectComposerMode(page: Page, label: string): Promise<void> {
  await page.getByTestId("agent-controls-settings").filter({ visible: true }).first().click();
  const menu = page.getByTestId("agent-settings-menu");
  await expect(menu).toBeVisible();
  await expectNoTruncation(menu);
  await page.getByTestId("agent-settings-permissions").click();
  await page.getByText(label, { exact: true }).last().click();
  await expect(menu).not.toBeVisible();
}
