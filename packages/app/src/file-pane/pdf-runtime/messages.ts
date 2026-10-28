export type PdfRuntimeCommand =
  | { type: "load"; revision: number; data: Uint8Array }
  | { type: "zoom"; action: "in" | "out" | "fit" };

export interface PdfViewState {
  page: number;
  pageCount: number;
  /** Rendered scale relative to the PDF's 100% size. */
  scale: number;
  fit: boolean;
}

export type PdfRuntimeMessage =
  | { type: "bridgeReady" }
  | ({ type: "state"; revision: number } & PdfViewState)
  | { type: "loadError"; revision: number }
  | { type: "openLink"; url: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function parsePdfRuntimeCommand(value: unknown): PdfRuntimeCommand | null {
  if (!isRecord(value)) return null;
  if (
    value.type === "load" &&
    isPositiveInteger(value.revision) &&
    value.data instanceof Uint8Array
  ) {
    return { type: "load", revision: value.revision, data: value.data };
  }
  if (
    value.type === "zoom" &&
    (value.action === "in" || value.action === "out" || value.action === "fit")
  ) {
    return { type: "zoom", action: value.action };
  }
  return null;
}

export function parsePdfRuntimeMessage(value: unknown): PdfRuntimeMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === "bridgeReady") return { type: "bridgeReady" };
  if (value.type === "loadError" && isPositiveInteger(value.revision)) {
    return { type: "loadError", revision: value.revision };
  }
  if (value.type === "openLink" && typeof value.url === "string") {
    return { type: "openLink", url: value.url };
  }
  if (
    value.type === "state" &&
    isPositiveInteger(value.revision) &&
    isPositiveInteger(value.page) &&
    isPositiveInteger(value.pageCount) &&
    typeof value.scale === "number" &&
    Number.isFinite(value.scale) &&
    typeof value.fit === "boolean"
  ) {
    return {
      type: "state",
      revision: value.revision,
      page: value.page,
      pageCount: value.pageCount,
      scale: value.scale,
      fit: value.fit,
    };
  }
  return null;
}
