import type { ComponentType } from "react";

export interface FilePdfPreviewProps {
  bytes: Uint8Array;
  size: number;
}

// Native has no PDF runtime yet; the pane falls back to the binary placeholder
// when this is null.
export const FilePdfPreview: ComponentType<FilePdfPreviewProps> | null = null;
