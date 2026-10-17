/**
 * The personal token permissions the plugin needs, named as Sentry's token form
 * names them. The connect guide lists them and connect errors name the missing one.
 */
export const SENTRY_TOKEN_PERMISSIONS = [
  { area: "Organization", level: "Read", scope: "org:read", why: "List your organizations" },
  { area: "Project", level: "Read", scope: "project:read", why: "List and filter projects" },
  {
    area: "Issue & Event",
    level: "Read",
    scope: "event:read",
    why: "Read issues and stack traces",
  },
] as const;

export type SentryTokenPermission = (typeof SENTRY_TOKEN_PERMISSIONS)[number];

/** Server error messages start with these, so the app can offer the matching fix. */
export const SENTRY_TOKEN_REJECTED = "Sentry rejected the auth token";
export const SENTRY_PERMISSION_MISSING = "The Sentry token is missing";

export function missingPermissionMessage(area: string, level: string): string {
  return `${SENTRY_PERMISSION_MISSING} the "${area}: ${level}" permission. Create a new personal token with it; Sentry does not let you edit a token's permissions.`;
}

/** Organization tokens start with `sntrys_` and only carry CI permissions, which cannot read issues. */
export function isOrganizationToken(token: string): boolean {
  return token.trim().startsWith("sntrys_");
}

/** Where to create a personal token for the Sentry at `baseUrl`. */
export function personalTokenUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/settings/account/api/auth-tokens/`;
}
