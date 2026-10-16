import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { BrowserKeyboardPolicy } from "./features/browser-keyboard/index.js";
import type { DesktopWindowChromeMode } from "./window/chrome.js";

// This preload runs in Electron's sandbox and is tsc-compiled (not bundled), so it MUST
// NOT emit any runtime module load other than "electron" — a require() of a local or
// third-party module throws and aborts the preload before exposeInMainWorld runs, leaving
// window.gravityDesktop undefined (the 0.1.108 regression, #2103). Keep this literal in sync
// with GRAVITY_BROWSER_PROFILE_PARTITION in features/browser-profile.ts; preload-sandbox.test.ts
// guards both the no-local-import rule and this drift. Type-only imports are fine (erased at emit).
const GRAVITY_BROWSER_PROFILE_PARTITION = "persist:gravity-browser";

type EventHandler = (payload: unknown) => void;

function readWindowChromeMode(): DesktopWindowChromeMode {
  const prefix = "--gravity-window-chrome-mode=";
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (value === "native-mac" || value === "custom-windows" || value === "custom-linux") {
    return value;
  }
  // COMPAT(windowChromeMode): added in v0.5.3; remove after 2026-11-25.
  if (process.platform === "darwin") return "native-mac";
  return process.platform === "linux" ? "custom-linux" : "custom-windows";
}

interface AttachedBrowserRegistration {
  browserId: string;
  workspaceId: string;
  webContentsId: number;
}

contextBridge.exposeInMainWorld("gravityDesktop", {
  platform: process.platform,
  windowChromeMode: readWindowChromeMode(),
  power: {
    invoke: (input: unknown): Promise<unknown> => ipcRenderer.invoke("gravity:power", input),
  },
  invoke: (command: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke("gravity:invoke", command, args),
  getPendingOpenProject: () =>
    ipcRenderer.invoke("gravity:get-pending-open-project") as Promise<string | null>,
  agentNavigation: {
    ready: () =>
      ipcRenderer.invoke("gravity:agent-navigation:ready") as Promise<{
        serverId: string;
        agentId: string;
      } | null>,
  },
  events: {
    on: (event: string, handler: EventHandler): Promise<() => void> => {
      const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
        handler(payload);
      };
      ipcRenderer.on(`gravity:event:${event}`, listener);
      return Promise.resolve(() => {
        ipcRenderer.removeListener(`gravity:event:${event}`, listener);
      });
    },
  },
  window: {
    openNew: (options?: { pendingOpenProjectPath?: string | null }) =>
      ipcRenderer.invoke("gravity:window:openNew", options),
    getCurrentWindow: () => ({
      minimize: () => ipcRenderer.invoke("gravity:window:minimize"),
      close: () => ipcRenderer.invoke("gravity:window:close"),
      toggleMaximize: () => ipcRenderer.invoke("gravity:window:toggleMaximize"),
      isMaximized: () => ipcRenderer.invoke("gravity:window:isMaximized"),
      setFullscreen: (fullscreen: boolean) =>
        ipcRenderer.invoke("gravity:window:setFullscreen", fullscreen),
      isFullscreen: () => ipcRenderer.invoke("gravity:window:isFullscreen"),
      updateChrome: (update: { backgroundColor?: string; trafficLightOffsetY?: number }) =>
        ipcRenderer.invoke("gravity:window:updateChrome", update),
      onResized: (handler: EventHandler): (() => void) => {
        const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
          handler(payload);
        };
        ipcRenderer.on("gravity:window:resized", listener);
        return () => {
          ipcRenderer.removeListener("gravity:window:resized", listener);
        };
      },
      setBadgeCount: (count?: number) => ipcRenderer.invoke("gravity:window:setBadgeCount", count),
    }),
  },
  dialog: {
    ask: (message: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke("gravity:dialog:ask", message, options),
    askWithCheckbox: (message: string, options: Record<string, unknown>) =>
      ipcRenderer.invoke("gravity:dialog:askWithCheckbox", message, options),
    open: (options?: Record<string, unknown>) => ipcRenderer.invoke("gravity:dialog:open", options),
  },
  notification: {
    isSupported: () => ipcRenderer.invoke("gravity:notification:isSupported"),
    sendNotification: (payload: { title: string; body?: string; data?: Record<string, unknown> }) =>
      ipcRenderer.invoke("gravity:notification:send", payload),
  },
  opener: {
    openUrl: (url: string) => ipcRenderer.invoke("gravity:opener:openUrl", url),
  },
  editor: {
    listTargets: () => ipcRenderer.invoke("gravity:editor:listTargets"),
    openTarget: (input: {
      editorId: string;
      workspacePath: string;
      filePath?: string;
      line?: number;
      column?: number;
    }) => ipcRenderer.invoke("gravity:editor:openTarget", input),
  },
  webUtils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  menu: {
    zoomApp: (direction: "in" | "out" | "reset") =>
      ipcRenderer.invoke("gravity:menu:zoom-app", direction),
    showContextMenu: (input?: Record<string, unknown>) =>
      ipcRenderer.invoke("gravity:menu:showContextMenu", input),
    setCapturingShortcut: (capturing: boolean) =>
      ipcRenderer.invoke("gravity:menu:set-capturing-shortcut", capturing),
  },
  browser: {
    setShortcutPolicy: (input: BrowserKeyboardPolicy) =>
      ipcRenderer.invoke("gravity:browser:set-shortcut-policy", input),
    profilePartition: GRAVITY_BROWSER_PROFILE_PARTITION,
    registerAttachedBrowser: (input: AttachedBrowserRegistration) =>
      ipcRenderer.invoke("gravity:browser:register-attached", input),
    unregisterWorkspaceBrowser: (browserId: string) =>
      ipcRenderer.invoke("gravity:browser:unregister-workspace-browser", browserId),
    setWorkspaceActiveBrowser: (input: { workspaceId: string; browserId: string | null }) =>
      ipcRenderer.invoke("gravity:browser:set-workspace-active-browser", input),
    focus: (browserId: string) => ipcRenderer.invoke("gravity:browser:focus", browserId),
    openDevTools: (browserId: string) =>
      ipcRenderer.invoke("gravity:browser:open-devtools", browserId),
    clearProfile: (legacyBrowserIds: string[]) =>
      ipcRenderer.invoke("gravity:browser:clear-profile", legacyBrowserIds),
    executeAutomationCommand: (request: Record<string, unknown>) =>
      ipcRenderer.invoke("gravity:browser:execute-automation-command", request),
    captureElement: (
      browserId: string,
      rect: { x: number; y: number; width: number; height: number },
    ) => ipcRenderer.invoke("gravity:browser:capture-element", browserId, rect),
    copyElement: (payload: { text?: string; imageDataUrl?: string }) =>
      ipcRenderer.invoke("gravity:browser:copy-element", payload),
  },
});
