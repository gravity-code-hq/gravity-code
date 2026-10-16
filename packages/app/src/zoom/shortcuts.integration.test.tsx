/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@/i18n/i18next";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useZoomShortcuts } from "./shortcuts.web";
import { useZoomTarget } from "./target.web";
import { useTextZoom } from "./use-text-zoom";
import { TerminalTextSizeMenu } from "@/terminal/text-size-menu";

const toast = { show: vi.fn(), copied: vi.fn(), error: vi.fn() };

function Terminal({ id, baseFontSize }: { id: string; baseFontSize: number }) {
  const { fontSize, zoom } = useTextZoom(baseFontSize, "terminal");
  const ref = useZoomTarget(".xterm-helper-textarea", zoom);
  return (
    <div ref={ref}>
      <textarea data-testid={id} className="xterm-helper-textarea" />
      <output data-testid={`${id}-size`}>{fontSize}</output>
      <TerminalTextSizeMenu fontSize={fontSize} onZoom={zoom} />
    </div>
  );
}

function Fixture({ baseFontSize = 14 }: { baseFontSize?: number }) {
  useZoomShortcuts();
  return (
    <I18nextProvider i18n={i18n}>
      <ToastApiProvider api={toast}>
        <button type="button" data-testid="sidebar">
          Sidebar
        </button>
        <Terminal id="first" baseFontSize={baseFontSize} />
        <Terminal id="second" baseFontSize={baseFontSize} />
      </ToastApiProvider>
    </I18nextProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  useKeyboardShortcutsStore.getState().setCapturingShortcut(false);
});

afterEach(() => {
  cleanup();
  delete window.gravityDesktop;
});

describe("zoom input routing", () => {
  it("routes desktop menu events to the focused pane, then to app zoom after focus leaves", async () => {
    let listener: (direction: unknown) => void = () => {};
    const zoomApp = vi.fn(async () => {});
    const unlisten = vi.fn();
    window.gravityDesktop = {
      platform: "darwin",
      events: {
        on: (_name, handler) => {
          listener = handler;
          return Promise.resolve(unlisten);
        },
      },
      menu: { zoomApp },
    };
    const fixture = render(<Fixture />);
    await act(async () => {});
    screen.getByTestId("first").focus();
    act(() => {
      listener("in");
      listener("in");
    });
    expect(screen.getByTestId("first-size").textContent).toBe("16");
    expect(screen.getByTestId("second-size").textContent).toBe("14");
    expect(toast.show).toHaveBeenLastCalledWith(
      "Terminal text: 16 px",
      expect.objectContaining({ durationMs: 1500 }),
    );
    expect(zoomApp).not.toHaveBeenCalled();

    fixture.rerender(<Fixture baseFontSize={18} />);
    expect(screen.getByTestId("first-size").textContent).toBe("16");
    expect(screen.getByTestId("second-size").textContent).toBe("18");
    act(() => listener("reset"));
    expect(screen.getByTestId("first-size").textContent).toBe("18");
    screen.getByTestId("sidebar").focus();
    act(() => listener("in"));
    expect(zoomApp).toHaveBeenCalledExactlyOnceWith("in");

    useKeyboardShortcutsStore.getState().setCapturingShortcut(true);
    act(() => listener("in"));
    expect(zoomApp).toHaveBeenCalledTimes(1);
    fixture.unmount();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("handles browser keyboard zoom only in content and preserves shortcut capture", () => {
    render(<Fixture />);
    const terminal = screen.getByTestId("first");
    terminal.focus();
    expect(fireEvent.keyDown(terminal, { key: "+", ctrlKey: true })).toBe(false);
    expect(screen.getByTestId("first-size").textContent).toBe("15");
    useKeyboardShortcutsStore.getState().setCapturingShortcut(true);
    expect(fireEvent.keyDown(terminal, { key: "-", ctrlKey: true })).toBe(true);
    expect(screen.getByTestId("first-size").textContent).toBe("15");
    useKeyboardShortcutsStore.getState().setCapturingShortcut(false);
    const sidebar = screen.getByTestId("sidebar");
    sidebar.focus();
    expect(fireEvent.keyDown(sidebar, { key: "+", ctrlKey: true })).toBe(true);
  });

  it("changes and resets terminal text through its menu", async () => {
    render(<Fixture />);
    fireEvent.click(screen.getAllByTestId("terminal-options")[0]!);
    fireEvent.click(await screen.findByTestId("terminal-text-size-menu"));
    fireEvent.click(await screen.findByTestId("terminal-text-increase"));
    expect(screen.getByTestId("first-size").textContent).toBe("15");
    expect(screen.getByTestId("terminal-text-size").textContent).toBe("15 px");
    expect(screen.getByTestId("second-size").textContent).toBe("14");
    fireEvent.click(screen.getByTestId("terminal-text-reset"));
    expect(screen.getByTestId("first-size").textContent).toBe("14");
  });
});
