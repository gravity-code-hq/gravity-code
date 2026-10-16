import { defaultWebSocketFactory } from "@gravity/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@gravity/client/internal/daemon-client-transport-types";

export function createAppWebSocketFactory(): WebSocketFactory {
  return defaultWebSocketFactory;
}
