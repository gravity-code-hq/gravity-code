export type ZoomDirection = "in" | "out" | "reset";

export const MIN_TEXT_SIZE = 8;
export const MAX_TEXT_SIZE = 32;

export function isZoomDirection(value: unknown): value is ZoomDirection {
  return value === "in" || value === "out" || value === "reset";
}

export interface TextZoomState {
  override: number | null;
  revision: number;
}

export function stepTextZoom(
  state: TextZoomState,
  direction: ZoomDirection,
  baseFontSize: number,
): TextZoomState {
  if (direction === "reset") return { override: null, revision: state.revision + 1 };
  const current = state.override ?? baseFontSize;
  const step = direction === "in" ? 1 : -1;
  const override = Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, current + step));
  return { override, revision: state.revision + 1 };
}
