import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  createProviderCommand,
  listProviderCustomizationFiles,
} from "../../../services/provider-customizations.js";
import { expandTilde } from "../../../utils/path.js";

export async function handleProviderCommandCreateRequest(
  request: Extract<SessionInboundMessage, { type: "provider.commands.create.request" }>,
  host: { emit(message: SessionOutboundMessage): void },
): Promise<void> {
  try {
    const result = await createProviderCommand({
      provider: request.provider,
      cwd: request.cwd ? expandTilde(request.cwd) : undefined,
      name: request.name,
      content: request.content,
    });
    host.emit({
      type: "provider.commands.create.response",
      payload: { requestId: request.requestId, ...result },
    });
  } catch (error) {
    host.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        code: "provider_command_create_failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export async function handleProviderCustomizationsRequest(
  request: Extract<SessionInboundMessage, { type: "provider.customizations.list.request" }>,
  host: {
    emit(message: SessionOutboundMessage): void;
  },
): Promise<void> {
  try {
    const cwd = request.cwd ? expandTilde(request.cwd) : undefined;
    const catalog = await listProviderCustomizationFiles({ provider: request.provider, cwd });
    host.emit({
      type: "provider.customizations.list.response",
      payload: { requestId: request.requestId, ...catalog },
    });
  } catch (error) {
    host.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        code: "provider_customizations_list_failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
