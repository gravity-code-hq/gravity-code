import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  ProviderAccountError,
  type ProviderAccountsService,
} from "../../../services/provider-accounts/service.js";

export interface ProviderAccountsSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface ProviderAccountsSessionOptions {
  host: ProviderAccountsSessionHost;
  providerAccountsService: ProviderAccountsService;
  logger: pino.Logger;
}

type RequestOf<TType extends SessionInboundMessage["type"]> = Extract<
  SessionInboundMessage,
  { type: TType }
>;

/** Session handlers for saved provider logins: list, save current, activate, remove. */
export class ProviderAccountsSession {
  private readonly host: ProviderAccountsSessionHost;
  private readonly service: ProviderAccountsService;
  private readonly logger: pino.Logger;

  constructor(options: ProviderAccountsSessionOptions) {
    this.host = options.host;
    this.service = options.providerAccountsService;
    this.logger = options.logger;
  }

  async handleListRequest(msg: RequestOf<"provider.accounts.list.request">): Promise<void> {
    try {
      const result = await this.service.list({ refresh: msg.refresh === true });
      this.host.emit({
        type: "provider.accounts.list.response",
        payload: {
          requestId: msg.requestId,
          fetchedAt: result.fetchedAt,
          providers: result.providers,
        },
      });
    } catch (error) {
      this.emitError(msg, error, "provider_accounts_list_failed", "Failed to list saved logins");
    }
  }

  async handleAddCurrentRequest(
    msg: RequestOf<"provider.accounts.add_current.request">,
  ): Promise<void> {
    try {
      const account = await this.service.addCurrent(msg.providerId);
      this.host.emit({
        type: "provider.accounts.add_current.response",
        payload: { requestId: msg.requestId, providerId: msg.providerId, account },
      });
    } catch (error) {
      this.emitError(
        msg,
        error,
        "provider_accounts_add_current_failed",
        "Failed to save the current login",
      );
    }
  }

  async handleActivateRequest(msg: RequestOf<"provider.accounts.activate.request">): Promise<void> {
    try {
      await this.service.activate(msg.providerId, msg.accountId);
      this.host.emit({
        type: "provider.accounts.activate.response",
        payload: {
          requestId: msg.requestId,
          providerId: msg.providerId,
          accountId: msg.accountId,
        },
      });
    } catch (error) {
      this.emitError(msg, error, "provider_accounts_activate_failed", "Failed to switch login");
    }
  }

  async handleRemoveRequest(msg: RequestOf<"provider.accounts.remove.request">): Promise<void> {
    try {
      await this.service.remove(msg.providerId, msg.accountId);
      this.host.emit({
        type: "provider.accounts.remove.response",
        payload: {
          requestId: msg.requestId,
          providerId: msg.providerId,
          accountId: msg.accountId,
        },
      });
    } catch (error) {
      this.emitError(msg, error, "provider_accounts_remove_failed", "Failed to remove saved login");
    }
  }

  private emitError(
    msg: { type: string; requestId: string },
    error: unknown,
    fallbackCode: string,
    context: string,
  ): void {
    const err = error instanceof Error ? error : new Error(String(error));
    // Expected refusals carry their own code so the client can explain them; anything
    // else is a failure worth a log line.
    const code = error instanceof ProviderAccountError ? `provider_account_${error.code}` : null;
    if (!code) this.logger.error({ err, requestType: msg.type }, context);
    this.host.emit({
      type: "rpc_error",
      payload: {
        requestId: msg.requestId,
        requestType: msg.type,
        error: code ? err.message : `${context}: ${err.message}`,
        code: code ?? fallbackCode,
      },
    });
  }
}
