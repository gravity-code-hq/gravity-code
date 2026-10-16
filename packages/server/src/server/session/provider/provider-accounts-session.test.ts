import pino from "pino";
import { describe, expect, it } from "vitest";
import type { ProviderAccount, SessionOutboundMessage } from "../../messages.js";
import {
  ProviderAccountError,
  type ProviderAccountsService,
} from "../../../services/provider-accounts/service.js";
import { ProviderAccountsSession } from "./provider-accounts-session.js";

const account: ProviderAccount = {
  id: "acc_1",
  email: "a@x",
  organizationName: null,
  displayName: null,
  planLabel: null,
  isActive: true,
  reloginRequired: false,
  addedAt: "2026-01-01T00:00:00.000Z",
  usage: null,
};

function makeSession(service: Partial<ProviderAccountsService>) {
  const emitted: SessionOutboundMessage[] = [];
  const session = new ProviderAccountsSession({
    host: { emit: (msg) => emitted.push(msg) },
    providerAccountsService: service as ProviderAccountsService,
    logger: pino({ level: "silent" }),
  });
  return { session, emitted };
}

describe("ProviderAccountsSession", () => {
  it("answers a list request with the service result", async () => {
    const { session, emitted } = makeSession({
      list: async () => ({ fetchedAt: "2026-01-01T00:00:00.000Z", providers: [] }),
    });

    await session.handleListRequest({ type: "provider.accounts.list.request", requestId: "r1" });

    expect(emitted).toEqual([
      {
        type: "provider.accounts.list.response",
        payload: { requestId: "r1", fetchedAt: "2026-01-01T00:00:00.000Z", providers: [] },
      },
    ]);
  });

  it("returns the saved account after adding the current login", async () => {
    const { session, emitted } = makeSession({ addCurrent: async () => account });

    await session.handleAddCurrentRequest({
      type: "provider.accounts.add_current.request",
      requestId: "r2",
      providerId: "claude",
    });

    expect(emitted).toEqual([
      {
        type: "provider.accounts.add_current.response",
        payload: { requestId: "r2", providerId: "claude", account },
      },
    ]);
  });

  it("surfaces an expected refusal with its own error code", async () => {
    const { session, emitted } = makeSession({
      activate: async () => {
        throw new ProviderAccountError("relogin_required", "a@x needs a new login");
      },
    });

    await session.handleActivateRequest({
      type: "provider.accounts.activate.request",
      requestId: "r3",
      providerId: "claude",
      accountId: "acc_1",
    });

    expect(emitted).toEqual([
      {
        type: "rpc_error",
        payload: {
          requestId: "r3",
          requestType: "provider.accounts.activate.request",
          error: "a@x needs a new login",
          code: "provider_account_relogin_required",
        },
      },
    ]);
  });

  it("wraps unexpected failures with the operation's fallback code", async () => {
    const { session, emitted } = makeSession({
      remove: async () => {
        throw new Error("disk full");
      },
    });

    await session.handleRemoveRequest({
      type: "provider.accounts.remove.request",
      requestId: "r4",
      providerId: "codex",
      accountId: "acc_1",
    });

    expect(emitted).toEqual([
      {
        type: "rpc_error",
        payload: {
          requestId: "r4",
          requestType: "provider.accounts.remove.request",
          error: "Failed to remove saved login: disk full",
          code: "provider_accounts_remove_failed",
        },
      },
    ]);
  });
});
