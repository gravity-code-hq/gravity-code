import { z } from "zod";
import type { ProviderUsage } from "../../server/messages.js";

export const ProviderAccountIdentitySchema = z.object({
  email: z.string(),
  accountUuid: z.string().nullable(),
  organizationUuid: z.string().nullable(),
  organizationName: z.string().nullable(),
  displayName: z.string().nullable(),
});

export type ProviderAccountIdentity = z.infer<typeof ProviderAccountIdentitySchema>;

/** Two logins are the same account when they share an email inside one organization. */
export function isSameAccount(a: ProviderAccountIdentity, b: ProviderAccountIdentity): boolean {
  return (
    a.email.toLowerCase() === b.email.toLowerCase() &&
    (a.organizationUuid ?? "") === (b.organizationUuid ?? "")
  );
}

export interface ProviderLiveLogin<TLogin> {
  identity: ProviderAccountIdentity;
  login: TLogin;
  /** False when the provider CLI has blanked the tokens after a failed refresh. */
  isUsable: boolean;
}

export type ProviderAccountUsageOutcome =
  | { kind: "usage"; usage: ProviderUsage }
  | { kind: "needs_auth" };

export type ProviderAccountRefreshOutcome<TLogin> =
  | { kind: "refreshed"; login: TLogin }
  | { kind: "relogin_required" };

export interface WriteLiveLoginInput<TLogin> {
  login: TLogin;
  /** The login being replaced, so machine-shared state can be carried over. */
  live: ProviderLiveLogin<TLogin> | null;
}

/**
 * One provider's account mechanics: where its CLI keeps the active login, how to read
 * usage for a stored one, and how to refresh a stored one that has gone stale.
 *
 * `TLogin` is the provider's own credential shape. It is opaque outside the adapter;
 * the store keeps it as JSON and hands it back through `parseLogin`.
 */
export interface ProviderAccountAdapter<TLogin = unknown> {
  readonly providerId: string;
  readonly displayName: string;
  parseLogin(value: unknown): TLogin;
  planLabel(login: TLogin, usage: ProviderUsage | null): string | null;
  isAccessTokenExpired(login: TLogin, nowMs: number): boolean;
  readLiveLogin(): Promise<ProviderLiveLogin<TLogin> | null>;
  writeLiveLogin(input: WriteLiveLoginInput<TLogin>): Promise<void>;
  fetchUsage(login: TLogin): Promise<ProviderAccountUsageOutcome>;
  /**
   * Redeems the login's refresh token. Only ever called for a login Gravity holds the
   * sole copy of; the active login belongs to the provider CLI and is never refreshed.
   */
  refreshLogin(login: TLogin): Promise<ProviderAccountRefreshOutcome<TLogin>>;
}
