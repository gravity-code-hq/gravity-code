import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { RadarService } from "../../radar/service.js";

export interface RadarSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface RadarSessionOptions {
  host: RadarSessionHost;
  /** Absent when the daemon was assembled without Radar; every request then fails. */
  radarService?: RadarService;
  logger: pino.Logger;
}

type RequestOf<TType extends SessionInboundMessage["type"]> = Extract<
  SessionInboundMessage,
  { type: TType }
>;

/** Session handlers for Radar: Slack channel watchers and their tasks. */
export class RadarSession {
  private readonly host: RadarSessionHost;
  private readonly radarService: RadarService | null;
  private readonly logger: pino.Logger;

  constructor(options: RadarSessionOptions) {
    this.host = options.host;
    this.radarService = options.radarService ?? null;
    this.logger = options.logger;
  }

  private get service(): RadarService {
    if (!this.radarService) {
      throw new Error("Radar is not available on this host");
    }
    return this.radarService;
  }

  async handleListRequest(msg: RequestOf<"radar.list.request">): Promise<void> {
    try {
      const radars = await this.service.list();
      this.host.emit({
        type: "radar.list.response",
        payload: { requestId: msg.requestId, radars },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to list radars");
    }
  }

  async handleCreateRequest(msg: RequestOf<"radar.create.request">): Promise<void> {
    try {
      const radar = await this.service.create({
        channel: msg.channel,
        cwd: msg.cwd,
        provider: msg.provider,
        model: msg.model,
        isolation: msg.isolation,
        instructions: msg.instructions,
      });
      this.host.emit({
        type: "radar.create.response",
        payload: { requestId: msg.requestId, radar },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to create the radar");
    }
  }

  async handleUpdateRequest(msg: RequestOf<"radar.update.request">): Promise<void> {
    try {
      const radar = await this.service.update({
        id: msg.radarId,
        channel: msg.channel,
        cwd: msg.cwd,
        model: msg.model,
        isolation: msg.isolation,
        instructions: msg.instructions,
      });
      this.host.emit({
        type: "radar.update.response",
        payload: { requestId: msg.requestId, radar },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to update the radar");
    }
  }

  async handleSetStatusRequest(msg: RequestOf<"radar.set_status.request">): Promise<void> {
    try {
      const radar = await this.service.setStatus(msg.radarId, msg.status);
      this.host.emit({
        type: "radar.set_status.response",
        payload: { requestId: msg.requestId, radar },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to update the radar");
    }
  }

  async handleDeleteRequest(msg: RequestOf<"radar.delete.request">): Promise<void> {
    try {
      await this.service.delete(msg.radarId);
      this.host.emit({
        type: "radar.delete.response",
        payload: { requestId: msg.requestId, radarId: msg.radarId },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to delete the radar");
    }
  }

  async handleCheckNowRequest(msg: RequestOf<"radar.check_now.request">): Promise<void> {
    try {
      const radar = await this.service.checkNow(msg.radarId, { lookBackMs: msg.lookBackMs });
      this.host.emit({
        type: "radar.check_now.response",
        payload: { requestId: msg.requestId, radar },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to check the radar");
    }
  }

  async handleChecksListRequest(msg: RequestOf<"radar.checks.list.request">): Promise<void> {
    try {
      const checks = await this.service.listChecks(msg.radarId, msg.limit);
      this.host.emit({
        type: "radar.checks.list.response",
        payload: { requestId: msg.requestId, radarId: msg.radarId, checks },
      });
    } catch (error) {
      this.emitError(msg, error, "Failed to load the radar's check history");
    }
  }

  private emitError(
    msg: { type: string; requestId: string },
    error: unknown,
    context: string,
  ): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error({ err, requestType: msg.type }, context);
    this.host.emit({
      type: "rpc_error",
      payload: {
        requestId: msg.requestId,
        requestType: msg.type,
        error: `${context}: ${err.message}`,
        code: "radar_request_failed",
      },
    });
  }
}
