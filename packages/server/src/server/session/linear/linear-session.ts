import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { LinearError } from "../../linear/client.js";
import type { LinearService } from "../../linear/service.js";

export interface LinearSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface LinearSessionOptions {
  host: LinearSessionHost;
  linearService: LinearService;
  logger: pino.Logger;
}

type RequestOf<TType extends SessionInboundMessage["type"]> = Extract<
  SessionInboundMessage,
  { type: TType }
>;

/** Session handlers for the Linear integration: connection status and issue reads. */
export class LinearSession {
  private readonly host: LinearSessionHost;
  private readonly service: LinearService;
  private readonly logger: pino.Logger;

  constructor(options: LinearSessionOptions) {
    this.host = options.host;
    this.service = options.linearService;
    this.logger = options.logger;
  }

  async handleGetStatusRequest(msg: RequestOf<"linear.get_status.request">): Promise<void> {
    try {
      const status = await this.service.getStatus();
      this.host.emit({
        type: "linear.get_status.response",
        payload: { requestId: msg.requestId, status },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to read Linear status");
    }
  }

  async handleConnectRequest(msg: RequestOf<"linear.connect.request">): Promise<void> {
    try {
      const status = await this.service.connect(msg.apiKey);
      this.host.emit({
        type: "linear.connect.response",
        payload: { requestId: msg.requestId, status },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to connect Linear");
    }
  }

  async handleDisconnectRequest(msg: RequestOf<"linear.disconnect.request">): Promise<void> {
    try {
      await this.service.disconnect();
      this.host.emit({
        type: "linear.disconnect.response",
        payload: { requestId: msg.requestId },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to disconnect Linear");
    }
  }

  async handleTeamsListRequest(msg: RequestOf<"linear.teams.list.request">): Promise<void> {
    try {
      const teams = await this.service.listTeams();
      this.host.emit({
        type: "linear.teams.list.response",
        payload: { requestId: msg.requestId, teams },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to list Linear teams");
    }
  }

  async handleIssuesListRequest(msg: RequestOf<"linear.issues.list.request">): Promise<void> {
    try {
      const result = await this.service.listIssues({
        filter: msg.filter,
        teamId: msg.teamId,
        search: msg.search,
        limit: msg.limit,
        after: msg.after,
      });
      this.host.emit({
        type: "linear.issues.list.response",
        payload: { requestId: msg.requestId, ...result },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to list Linear issues");
    }
  }

  async handleIssuesGetRequest(msg: RequestOf<"linear.issues.get.request">): Promise<void> {
    try {
      const issue = await this.service.getIssue(msg.issueId);
      this.host.emit({
        type: "linear.issues.get.response",
        payload: { requestId: msg.requestId, issue },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to load the Linear issue");
    }
  }

  async handleIssuesSetStateRequest(
    msg: RequestOf<"linear.issues.set_state.request">,
  ): Promise<void> {
    try {
      const issue = await this.service.setIssueState(msg.issueId, msg.stateId);
      this.host.emit({
        type: "linear.issues.set_state.response",
        payload: { requestId: msg.requestId, issue },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to update the Linear issue");
    }
  }

  private emitError(
    msg: { type: string; requestId: string },
    error: unknown,
    context: string,
  ): void {
    const err = error instanceof Error ? error : new Error(String(error));
    // Linear refusals (bad key, rate limit, not connected) carry a code the app
    // explains; anything else is a daemon-side failure worth a log line.
    const code = error instanceof LinearError ? `linear_${error.code}` : null;
    if (!code) this.logger.error({ err, requestType: msg.type }, context);
    this.host.emit({
      type: "rpc_error",
      payload: {
        requestId: msg.requestId,
        requestType: msg.type,
        error: code ? err.message : `${context}: ${err.message}`,
        code: code ?? "linear_request_failed",
      },
    });
  }
}
