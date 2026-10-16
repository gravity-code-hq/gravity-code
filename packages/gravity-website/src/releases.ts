export type DownloadPlatformId = "mac-arm64" | "linux-x64";

export interface InstallStep {
  text: string;
  command?: string;
}

export interface DownloadPlatform {
  id: DownloadPlatformId;
  name: string;
  badge: string;
  format: string;
  formatLabel: string;
  requirement: string;
  shortLabel: string;
  actionLabel: string;
  url: string;
  installSteps: InstallStep[];
}

// Every desktop release uploads these fixed-name assets (.github/workflows/desktop-release.yml),
// so the links always serve the newest stable build without a site redeploy.
const LATEST_DOWNLOAD_BASE =
  "https://github.com/gravity-code-hq/gravity-code/releases/latest/download";

export const macDownload: DownloadPlatform = {
  id: "mac-arm64",
  name: "macOS",
  badge: "BUILT FOR APPLE SILICON",
  format: ".dmg",
  formatLabel: "Disk image",
  requirement: "For Macs with an M-series chip · macOS 13+",
  shortLabel: "Download for Mac",
  actionLabel: "Download for Apple Silicon",
  url: `${LATEST_DOWNLOAD_BASE}/gravity-macos-arm64.dmg`,
  installSteps: [
    { text: "Open the Gravity disk image from your Downloads folder." },
    { text: "Drag Gravity into your Applications folder." },
    { text: "Open Gravity from Applications. The daemon starts automatically." },
  ],
};

export const linuxDownload: DownloadPlatform = {
  id: "linux-x64",
  name: "Linux",
  badge: "BUILT FOR LINUX X64",
  format: ".deb",
  formatLabel: "Debian package",
  requirement: "For Ubuntu, Debian, and Mint · 64-bit Intel or AMD",
  shortLabel: "Download for Linux",
  actionLabel: "Download for Linux (.deb)",
  url: `${LATEST_DOWNLOAD_BASE}/gravity-linux-x64.deb`,
  installSteps: [
    {
      text: "Open the downloaded .deb with your software installer, or install it from your Downloads folder:",
      command: "sudo apt install ./gravity-linux-x64.deb",
    },
    { text: "Launch Gravity from your app menu. The daemon starts automatically." },
  ],
};

export const downloads: readonly DownloadPlatform[] = [macDownload, linuxDownload];

export const releaseVersion = import.meta.env.VITE_GRAVITY_VERSION?.trim();

// Visitors on Linux get the .deb; everyone else (macOS, iOS, Windows, unknown) gets the DMG.
// Android reports "Linux" in its user agent, so it is excluded explicitly.
export function detectDownloadPlatform(): DownloadPlatform {
  if (typeof navigator === "undefined") return macDownload;
  const userAgent = navigator.userAgent;
  if (/Android/i.test(userAgent)) return macDownload;
  if (/Linux|X11/i.test(userAgent)) return linuxDownload;
  return macDownload;
}

export function findDownloadPlatform(id: string | null): DownloadPlatform | null {
  return downloads.find((platform) => platform.id === id) ?? null;
}

// Download buttons land here first; the page starts the download and shows install steps.
// The platform travels in the query string so the started page never re-detects it.
export function downloadStartedPath(platform: DownloadPlatform): string {
  return `/download/started/?platform=${platform.id}`;
}
