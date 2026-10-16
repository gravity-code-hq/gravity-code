import type { TFunction } from "i18next";
import { linearErrorCode } from "@/linear/use-linear";
import { toErrorMessage } from "@/utils/error-messages";

/** User-facing copy for a failed Linear call, keyed off the daemon's error code. */
export function describeLinearError(error: unknown, t: TFunction): string {
  switch (linearErrorCode(error)) {
    case "linear_auth":
      return t("linear.errors.auth");
    case "linear_rate_limited":
      return t("linear.errors.rateLimited");
    case "linear_network":
      return t("linear.errors.network");
    case "linear_not_connected":
      return t("linear.errors.notConnected");
    default:
      return toErrorMessage(error);
  }
}
