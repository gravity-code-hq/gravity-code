import type { ReactNode } from "react";
import type { ToolCallDetail } from "@gravity/protocol/agent-types";

export interface ToolCallHoverPreviewProps {
  children: ReactNode;
  disabled: boolean;
  toolName: string;
  displayName: string;
  detail: ToolCallDetail | undefined;
  errorText: string | undefined;
  showLoadingSkeleton: boolean;
}
