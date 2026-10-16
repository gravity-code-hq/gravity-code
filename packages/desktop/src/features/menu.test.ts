import { describe, expect, it, vi } from "vitest";
import { BrowserWindow, MenuItem } from "electron";
import { buildApplicationMenuTemplate, reloadActiveBrowserOrWindow } from "./menu.js";

vi.mock("electron", () => ({
  app: { name: "Gravity" },
  Menu: {},
  MenuItem: vi.fn(function () {}),
  ipcMain: {},
  BrowserWindow: class {
    webContents = { send: vi.fn(), setZoomLevel: vi.fn(), getZoomLevel: () => 1 };
  },
}));

describe("zoom menu", () => {
  it("routes zoom to the renderer instead of changing the whole window", () => {
    const template = buildApplicationMenuTemplate({ onNewWindow: vi.fn() }, false);
    const view = template.find((item) => item.label === "View");
    if (!Array.isArray(view?.submenu)) throw new Error("Missing View menu");
    const win = new BrowserWindow();
    for (const [label, direction] of [
      ["Zoom In", "in"],
      ["Zoom Out", "out"],
      ["Reset Size", "reset"],
      ["Zoom In (+)", "in"],
    ]) {
      const item = view.submenu.find((entry) => entry.label === label);
      if (!item?.click) throw new Error(`Missing ${label}`);
      item.click(new MenuItem({}), win, {});
      expect(win.webContents.send).toHaveBeenLastCalledWith("gravity:event:zoom", direction);
    }
    expect(win.webContents.setZoomLevel).not.toHaveBeenCalled();
  });

  it("disables every zoom accelerator while recording a shortcut", () => {
    const template = buildApplicationMenuTemplate({ onNewWindow: vi.fn() }, true);
    const view = template.find((item) => item.label === "View");
    if (!Array.isArray(view?.submenu)) throw new Error("Missing View menu");
    const zoomItems = view.submenu.filter(
      (item) => item.label?.startsWith("Zoom") || item.label === "Reset Size",
    );
    expect(zoomItems).toHaveLength(4);
    expect(zoomItems.every((item) => item.enabled === false)).toBe(true);
  });

  it("keeps explicit App Zoom independent of focused content", () => {
    const template = buildApplicationMenuTemplate({ onNewWindow: vi.fn() }, false);
    const view = template.find((item) => item.label === "View");
    if (!Array.isArray(view?.submenu)) throw new Error("Missing View menu");
    const appZoom = view.submenu.find((item) => item.label === "App Zoom");
    if (!Array.isArray(appZoom?.submenu)) throw new Error("Missing App Zoom menu");
    const zoomIn = appZoom.submenu.find((item) => item.label === "Zoom In");
    if (!zoomIn?.click) throw new Error("Missing Zoom In");
    const win = new BrowserWindow();
    zoomIn.click(new MenuItem({}), win, {});
    expect(win.webContents.setZoomLevel).toHaveBeenCalledExactlyOnceWith(1.5);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});

class FakeWebContents {
  public readonly reloads: string[] = [];

  public constructor(public readonly id: number) {}

  public isLoadingMainFrame(): boolean {
    return false;
  }

  public stop(): void {
    this.reloads.push("stop");
  }

  public reload(): void {
    this.reloads.push("reload");
  }

  public reloadIgnoringCache(): void {
    this.reloads.push("force-reload");
  }
}

class BrowserReloads {
  public readonly firstWindow = { webContents: new FakeWebContents(101) };
  public readonly secondWindow = { webContents: new FakeWebContents(202) };
  public readonly firstBrowser = new FakeWebContents(11);
  public readonly secondBrowser = new FakeWebContents(22);
  public readonly resolvedHostWindowIds: number[] = [];

  public activeBrowserForHostWindow(hostWebContentsId: number): FakeWebContents | null {
    this.resolvedHostWindowIds.push(hostWebContentsId);
    return hostWebContentsId === 101 ? this.firstBrowser : this.secondBrowser;
  }
}

describe("reloadActiveBrowserOrWindow", () => {
  it("reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.firstWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([101]);
    expect(browserReloads.firstBrowser.reloads).toEqual(["reload"]);
    expect(browserReloads.secondBrowser.reloads).toEqual([]);
    expect(browserReloads.firstWindow.webContents.reloads).toEqual([]);
  });

  it("force reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.secondWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
      ignoreCache: true,
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([202]);
    expect(browserReloads.firstBrowser.reloads).toEqual([]);
    expect(browserReloads.secondBrowser.reloads).toEqual(["force-reload"]);
    expect(browserReloads.secondWindow.webContents.reloads).toEqual([]);
  });
});
