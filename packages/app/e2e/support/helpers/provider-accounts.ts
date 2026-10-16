import type { Page } from "@playwright/test";
import type { ProviderAccount, ProviderAccountsProvider } from "@gravity/protocol/messages";
import { daemonWsRoutePattern } from "./daemon-port";

export interface ProviderAccountsListBody {
  fetchedAt: string;
  providers: ProviderAccountsProvider[];
}

export interface ProviderAccountsRpcError {
  error: string;
  code: string;
}

export interface ProviderAccountsFixtureScript {
  /** The list payload for the nth list request (0-based); the last entry repeats. */
  list: ProviderAccountsListBody[];
  addCurrent?: (request: { providerId: string }) => ProviderAccount | ProviderAccountsRpcError;
  activate?: (request: {
    providerId: string;
    accountId: string;
  }) => "ok" | ProviderAccountsRpcError;
  remove?: (request: { providerId: string; accountId: string }) => "ok" | ProviderAccountsRpcError;
}

export type ProviderAccountsRequestType = "list" | "add_current" | "activate" | "remove";

export interface ProviderAccountsFixture {
  requestCount(type: ProviderAccountsRequestType): number;
  waitForRequestCount(type: ProviderAccountsRequestType, count: number): Promise<void>;
}

type WebSocketMessage = string | Buffer;

const REQUEST_TYPES: Record<string, ProviderAccountsRequestType> = {
  "provider.accounts.list.request": "list",
  "provider.accounts.add_current.request": "add_current",
  "provider.accounts.activate.request": "activate",
  "provider.accounts.remove.request": "remove",
};

function parseJson(message: WebSocketMessage): unknown {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const envelope = parseJson(message);
  if (!envelope || typeof envelope !== "object") {
    return null;
  }
  const maybeEnvelope = envelope as { type?: unknown; message?: unknown };
  if (maybeEnvelope.type !== "session" || !maybeEnvelope.message) {
    return null;
  }
  if (typeof maybeEnvelope.message !== "object") {
    return null;
  }
  return maybeEnvelope.message as Record<string, unknown>;
}

function withProviderAccountsFeature(message: WebSocketMessage): string | null {
  const envelope = parseJson(message);
  if (!envelope || typeof envelope !== "object") {
    return null;
  }
  const maybeEnvelope = envelope as {
    type?: unknown;
    message?: {
      type?: unknown;
      payload?: Record<string, unknown>;
    };
  };
  const payload = maybeEnvelope.message?.payload;
  if (
    maybeEnvelope.type !== "session" ||
    maybeEnvelope.message?.type !== "status" ||
    payload?.status !== "server_info"
  ) {
    return null;
  }
  return JSON.stringify({
    ...maybeEnvelope,
    message: {
      ...maybeEnvelope.message,
      payload: {
        ...payload,
        features: {
          ...(typeof payload.features === "object" && payload.features !== null
            ? payload.features
            : {}),
          providerAccounts: true,
        },
      },
    },
  });
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function sessionMessage(message: Record<string, unknown>): string {
  return JSON.stringify({ type: "session", message });
}

function rpcError(request: Record<string, unknown>, failure: ProviderAccountsRpcError): string {
  return sessionMessage({
    type: "rpc_error",
    payload: {
      requestId: request.requestId,
      requestType: request.type,
      error: failure.error,
      code: failure.code,
    },
  });
}

/**
 * Answers the saved-login RPCs at the WebSocket boundary so the page runs against a
 * scripted daemon while everything else still reaches the real one.
 */
export async function installProviderAccountsFixture(
  page: Page,
  script: ProviderAccountsFixtureScript,
): Promise<ProviderAccountsFixture> {
  const counts: Record<ProviderAccountsRequestType, number> = {
    list: 0,
    add_current: 0,
    activate: 0,
    remove: 0,
  };
  const waiters: Array<{ type: ProviderAccountsRequestType; count: number; resolve: () => void }> =
    [];

  function notifyWaiters() {
    for (const waiter of waiters.splice(0)) {
      if (counts[waiter.type] >= waiter.count) {
        waiter.resolve();
      } else {
        waiters.push(waiter);
      }
    }
  }

  function respond(request: Record<string, unknown>): string {
    const type = REQUEST_TYPES[requireString(request.type, "type")]!;
    const requestId = requireString(request.requestId, "requestId");
    counts[type] += 1;
    notifyWaiters();

    switch (type) {
      case "list": {
        const body = script.list[Math.min(counts.list - 1, script.list.length - 1)];
        if (!body) throw new Error("Provider accounts fixture requires at least one list body.");
        return sessionMessage({
          type: "provider.accounts.list.response",
          payload: { requestId, fetchedAt: body.fetchedAt, providers: body.providers },
        });
      }
      case "add_current": {
        const providerId = requireString(request.providerId, "providerId");
        const outcome = script.addCurrent?.({ providerId });
        if (!outcome) throw new Error("Provider accounts fixture has no addCurrent script.");
        if ("code" in outcome) return rpcError(request, outcome);
        return sessionMessage({
          type: "provider.accounts.add_current.response",
          payload: { requestId, providerId, account: outcome },
        });
      }
      case "activate":
      case "remove": {
        const providerId = requireString(request.providerId, "providerId");
        const accountId = requireString(request.accountId, "accountId");
        const handler = type === "activate" ? script.activate : script.remove;
        const outcome = handler?.({ providerId, accountId });
        if (!outcome) throw new Error(`Provider accounts fixture has no ${type} script.`);
        if (outcome !== "ok") return rpcError(request, outcome);
        return sessionMessage({
          type: `provider.accounts.${type}.response`,
          payload: { requestId, providerId, accountId },
        });
      }
    }
  }

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const request = getSessionMessage(message);
      if (request && typeof request.type === "string" && request.type in REQUEST_TYPES) {
        ws.send(respond(request));
        return;
      }
      server.send(message);
    });

    server.onMessage((message) => {
      const serverInfo = typeof message === "string" ? withProviderAccountsFeature(message) : null;
      ws.send(serverInfo ?? message);
    });
  });

  return {
    requestCount(type) {
      return counts[type];
    },
    waitForRequestCount(type, count) {
      if (counts[type] >= count) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        waiters.push({ type, count, resolve });
      });
    },
  };
}
