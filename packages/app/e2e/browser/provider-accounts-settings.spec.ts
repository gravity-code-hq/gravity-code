import type { Page } from "@playwright/test";
import type { ProviderAccount, ProviderAccountsProvider } from "@gravity/protocol/messages";
import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { buildSettingsRoute } from "@/utils/host-routes";
import {
  installProviderAccountsFixture,
  type ProviderAccountsListBody,
} from "../support/helpers/provider-accounts";

function account(
  overrides: Partial<ProviderAccount> & { id: string; email: string },
): ProviderAccount {
  return {
    organizationName: "Acme",
    displayName: null,
    planLabel: "Max 5x",
    isActive: false,
    reloginRequired: false,
    addedAt: "2026-06-19T00:00:00.000Z",
    usage: {
      providerId: "claude",
      displayName: "Claude",
      status: "available",
      planLabel: "Max 5x",
      windows: [
        { id: "five_hour", label: "Session", usedPct: 12 },
        { id: "weekly", label: "Weekly", usedPct: 48 },
      ],
      balances: [],
      details: [],
      error: null,
    },
    ...overrides,
  };
}

const work = account({ id: "acc_00000000000000a1", email: "work@example.com", isActive: true });
const personal = account({
  id: "acc_00000000000000b2",
  email: "personal@example.com",
  organizationName: "Personal",
  usage: {
    providerId: "claude",
    displayName: "Claude",
    status: "available",
    planLabel: "Pro",
    windows: [{ id: "weekly", label: "Weekly", usedPct: 91 }],
    balances: [],
    details: [],
    error: null,
  },
});

function claude(
  accounts: ProviderAccount[],
  liveLogin: ProviderAccountsProvider["liveLogin"],
): ProviderAccountsProvider {
  return { providerId: "claude", displayName: "Claude Code", liveLogin, accounts, error: null };
}

function codexWithoutLogin(): ProviderAccountsProvider {
  return { providerId: "codex", displayName: "Codex", liveLogin: null, accounts: [], error: null };
}

function listBody(providers: ProviderAccountsProvider[], fetchedAt = "2026-06-19T00:00:00.000Z") {
  return { fetchedAt, providers } satisfies ProviderAccountsListBody;
}

async function openClaudeCodePage(page: Page): Promise<void> {
  await page.getByTestId("settings-host-section-claude").click();
  await expect(page.getByTestId("provider-settings-page")).toBeVisible({ timeout: 10_000 });
}

test.describe("provider accounts settings", () => {
  test("shows current and saved account usage on both provider pages", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.clock.setFixedTime(new Date("2026-09-23T12:00:00Z"));
    await page.addInitScript(() => {
      localStorage.setItem("@gravity:app-settings", JSON.stringify({ theme: "dark" }));
    });
    const providers = ["claude", "codex"].map((providerId): ProviderAccountsProvider => {
      const displayName = providerId === "claude" ? "Claude Code" : "Codex";
      const planLabel = providerId === "claude" ? "Max 5x" : "Plus";
      const usage = {
        providerId,
        displayName,
        status: "available" as const,
        planLabel,
        windows: [
          { id: "session", label: "Session", usedPct: 76, resetsAt: "2026-09-23T14:47:00Z" },
          { id: "weekly", label: "Weekly", usedPct: 59, resetsAt: "2026-09-28T15:00:00Z" },
        ],
      };
      const saved = account({
        ...personal,
        email: "work@example.com",
        organizationName: "Work",
        planLabel,
        usage: {
          ...usage,
          windows: [
            { ...usage.windows[0]!, usedPct: 96 },
            { ...usage.windows[1]!, usedPct: 40 },
            ...(providerId === "claude"
              ? [{ id: "fable", label: "Fable", usedPct: 71, resetsAt: "2026-09-28T09:00:00Z" }]
              : []),
          ],
        },
      });
      return {
        providerId,
        displayName,
        error: null,
        accounts: [
          account({
            id: work.id,
            email: "personal@example.com",
            organizationName: "Personal",
            planLabel,
            usage,
            isActive: true,
          }),
          saved,
        ],
        liveLogin: {
          email: "personal@example.com",
          organizationName: "Personal",
          accountId: work.id,
          isUsable: true,
          planLabel,
          usage,
        },
      };
    });
    await installProviderAccountsFixture(page, { list: [listBody(providers)] });
    await gotoAppShell(page);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const provider of ["claude", "codex"]) {
        await page.goto(buildSettingsRoute());
        await page.getByTestId(`settings-host-section-${provider}`).click();
        const live = page.getByTestId(`provider-account-${work.id}`);
        const saved = page.getByTestId(`provider-account-${personal.id}`);
        await expect(live.getByText("Active", { exact: true })).toBeVisible();
        await expect(live.getByText("76% · resets 2h 47m", { exact: true })).toBeVisible();
        await expect(live.getByText("59% · resets 5d 3h", { exact: true })).toBeVisible();
        await expect(saved.getByText("96% · resets 2h 47m", { exact: true })).toBeVisible();
        await expect(saved.getByText("40% · resets 5d 3h", { exact: true })).toBeVisible();
        await expect(page.getByTestId(`provider-account-switch-${personal.id}`)).toBeVisible();
        await expect(page.getByText("Loading models...", { exact: true })).toHaveCount(0);
        const toolbar = page.getByTestId("provider-models-toolbar");
        await expect(toolbar.getByRole("button")).toHaveCount(3);
        const centers = await toolbar.locator('input, [role="button"]').evaluateAll((controls) => {
          const result: number[] = [];
          for (const control of controls) {
            const bounds = control.getBoundingClientRect();
            result.push(bounds.top + bounds.height / 2);
          }
          return result;
        });
        expect(centers).toHaveLength(4);
        expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
        await page.mouse.move(width - 1, 0);
        await page.screenshot({
          path: testInfo.outputPath(`${provider}-accounts-${width}.png`),
          fullPage: true,
        });
      }
    }
  });

  test("lists all saved accounts without a manual save action", async ({ page }) => {
    test.setTimeout(120_000);
    const third = account({ id: "acc_00000000000000c3", email: "third@example.com" });
    const fixture = await installProviderAccountsFixture(page, {
      list: [
        listBody([
          claude([work, personal, third], {
            email: work.email,
            organizationName: "Acme",
            accountId: work.id,
            isUsable: true,
          }),
          codexWithoutLogin(),
        ]),
      ],
    });
    await gotoAppShell(page);
    await openSettings(page);
    await openClaudeCodePage(page);
    await fixture.waitForRequestCount("list", 1);
    const section = page.getByTestId("provider-accounts-claude");
    await expect(section.getByText("Active", { exact: true })).toHaveCount(1);
    await expect(section.getByText("work@example.com", { exact: true })).toBeVisible();
    await expect(section.getByText("personal@example.com", { exact: true })).toBeVisible();
    await expect(section.getByText("third@example.com", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`provider-account-switch-${personal.id}`)).toBeVisible();
    await expect(page.getByTestId(`provider-account-switch-${third.id}`)).toBeVisible();
    await expect(page.getByTestId(`provider-account-actions-${work.id}`)).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Save current login" })).toHaveCount(0);
    expect(fixture.requestCount("add_current")).toBe(0);
  });

  test("switching activates the chosen login and refetches the list", async ({ page }) => {
    test.setTimeout(120_000);
    const third = account({ id: "acc_00000000000000c3", email: "third@example.com" });
    const activated: string[] = [];
    const fixture = await installProviderAccountsFixture(page, {
      list: [
        listBody([
          claude([work, personal, third], {
            email: work.email,
            organizationName: "Acme",
            accountId: work.id,
            isUsable: true,
          }),
        ]),
        listBody(
          [
            claude([{ ...work, isActive: false }, { ...personal, isActive: true }, third], {
              email: personal.email,
              organizationName: "Personal",
              accountId: personal.id,
              isUsable: true,
            }),
          ],
          "2026-06-19T00:01:00.000Z",
        ),
      ],
      activate: ({ accountId }) => {
        activated.push(accountId);
        return "ok";
      },
    });

    await gotoAppShell(page);
    await openSettings(page);
    await openClaudeCodePage(page);
    await fixture.waitForRequestCount("list", 1);

    await page.getByTestId(`provider-account-switch-${personal.id}`).click();
    await fixture.waitForRequestCount("activate", 1);
    await fixture.waitForRequestCount("list", 2);

    expect(activated).toEqual([personal.id]);
    const personalRow = page.getByTestId(`provider-account-${personal.id}`);
    await expect(personalRow.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`provider-account-switch-${work.id}`)).toBeVisible();
    await expect(page.getByTestId(`provider-account-switch-${third.id}`)).toBeVisible();
    await expect(
      page.getByTestId("provider-accounts-claude").getByText("Active", { exact: true }),
    ).toHaveCount(1);
  });

  test("a refused switch stays visible until dismissed", async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = await installProviderAccountsFixture(page, {
      list: [
        listBody([
          claude([work, personal], {
            email: work.email,
            organizationName: "Acme",
            accountId: work.id,
            isUsable: true,
          }),
        ]),
      ],
      activate: () => ({
        error: "personal@example.com needs a new login before it can be activated",
        code: "provider_account_relogin_required",
      }),
    });

    await gotoAppShell(page);
    await openSettings(page);
    await openClaudeCodePage(page);
    await fixture.waitForRequestCount("list", 1);

    await page.getByTestId(`provider-account-switch-${personal.id}`).click();
    await fixture.waitForRequestCount("activate", 1);

    const claudeSection = page.getByTestId("provider-accounts-claude");
    await expect(
      claudeSection.getByText("Unable to switch account", { exact: true }),
    ).toBeVisible();
    await expect(
      claudeSection.getByText("personal@example.com needs a new login before it can be activated", {
        exact: true,
      }),
    ).toBeVisible();
    expect(fixture.requestCount("list")).toBe(1);
    await expect(page.getByTestId(`provider-account-switch-${personal.id}`)).toBeEnabled();

    await claudeSection.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(claudeSection.getByText("Unable to switch account", { exact: true })).toHaveCount(
      0,
    );
  });
});
