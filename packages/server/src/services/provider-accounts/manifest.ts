import { join } from "node:path";
import type { Logger } from "pino";
import type { ProviderApiFetch } from "../quota-fetcher/provider.js";
import { ClaudeQuotaProvider } from "../quota-fetcher/providers/claude.js";
import { CodexQuotaProvider } from "../quota-fetcher/providers/codex.js";
import { ClaudeAccountAdapter } from "./claude/adapter.js";
import { CodexAccountAdapter } from "./codex/adapter.js";
import { ProviderAccountsService } from "./service.js";
import { ProviderAccountStore } from "./store.js";

export interface CreateProviderAccountsServiceOptions {
  logger: Logger;
  gravityHome: string;
  fetch?: ProviderApiFetch;
}

export function providerAccountsDir(gravityHome: string): string {
  return join(gravityHome, "provider-accounts");
}

/** The daemon's saved-login service with every provider that supports account switching. */
export function createProviderAccountsService(
  options: CreateProviderAccountsServiceOptions,
): ProviderAccountsService {
  const { logger, fetch } = options;
  return new ProviderAccountsService({
    logger,
    store: new ProviderAccountStore(providerAccountsDir(options.gravityHome)),
    adapters: [
      new ClaudeAccountAdapter({
        logger,
        fetch,
        usage: new ClaudeQuotaProvider({ logger, fetch }),
      }),
      new CodexAccountAdapter({
        logger,
        fetch,
        usage: new CodexQuotaProvider({ logger, fetch }),
      }),
    ],
  });
}
