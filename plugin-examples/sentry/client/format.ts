import type { PluginTheme } from "@gravity/plugin";

const UNITS: [suffix: string, seconds: number][] = [
  ["y", 365 * 24 * 3600],
  ["mo", 30 * 24 * 3600],
  ["w", 7 * 24 * 3600],
  ["d", 24 * 3600],
  ["h", 3600],
  ["m", 60],
];

/** `3h ago`, `2d ago`, `just now`. */
export function formatAge(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  for (const [suffix, size] of UNITS) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${suffix} ago`;
  }
  return "just now";
}

/** `987`, `1.2k`, `34k`, `1.5M`. */
export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const thousands = value / 1000;
    return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function levelColor(level: string, theme: PluginTheme): string {
  if (level === "fatal" || level === "error") return theme.colors.statusDanger;
  if (level === "warning") return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
