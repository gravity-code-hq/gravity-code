/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindZoomTarget, dispatchContentZoom, zoomDirectionForKey } from "./target.web";
import { stepTextZoom } from "./text-size";

afterEach(() => document.body.replaceChildren());

describe("focused content zoom", () => {
  it("changes text in one-pixel steps, clamps it, and resets to the current default", () => {
    const initial = { override: null, revision: 0 };
    const first = stepTextZoom(initial, "in", 14);
    const second = stepTextZoom(first, "in", 14);
    expect(first.override).toBe(15);
    expect(second.override).toBe(16);
    expect(stepTextZoom(second, "out", 14).override).toBe(15);
    expect(stepTextZoom({ override: 32, revision: 0 }, "in", 14).override).toBe(32);
    expect(stepTextZoom({ override: 8, revision: 0 }, "out", 14).override).toBe(8);
    const reset = stepTextZoom(second, "reset", 18);
    expect(reset.override).toBeNull();
    expect(stepTextZoom(reset, "in", 18).override).toBe(19);
    expect(initial.override).toBeNull();
  });
  it("zooms only the focused terminal and leaves app chrome to app zoom", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const input = document.createElement("textarea");
    input.className = "xterm-helper-textarea";
    first.append(input);
    const sidebar = document.createElement("button");
    document.body.append(first, second, sidebar);
    const zoomFirst = vi.fn();
    const zoomSecond = vi.fn();
    const unbindFirst = bindZoomTarget(first, ".xterm-helper-textarea", zoomFirst);
    const unbindSecond = bindZoomTarget(second, ".xterm-helper-textarea", zoomSecond);

    input.focus();
    expect(dispatchContentZoom("in")).toBe(true);
    expect(zoomFirst).toHaveBeenCalledExactlyOnceWith("in");
    expect(zoomSecond).not.toHaveBeenCalled();
    sidebar.focus();
    expect(dispatchContentZoom("out")).toBe(false);
    expect(zoomFirst).toHaveBeenCalledTimes(1);

    unbindFirst();
    unbindSecond();
    input.focus();
    expect(dispatchContentZoom("in")).toBe(false);
  });

  it("routes reset to a focused editor without capturing unrelated inputs", () => {
    const root = document.createElement("div");
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const content = document.createElement("textarea");
    editor.append(content);
    const search = document.createElement("input");
    root.append(editor, search);
    document.body.append(root);
    const zoom = vi.fn();
    const unbind = bindZoomTarget(root, ".cm-editor", zoom);
    content.focus();
    expect(dispatchContentZoom("reset")).toBe(true);
    expect(zoom).toHaveBeenCalledExactlyOnceWith("reset");
    search.focus();
    expect(dispatchContentZoom("in")).toBe(false);
    unbind();
  });

  it.each([
    ["=", false, "in"],
    ["+", true, "in"],
    ["-", false, "out"],
    ["0", false, "reset"],
    ["_", true, null],
    ["1", false, null],
  ] as const)("matches the Mac zoom chord %s", (key, shiftKey, direction) => {
    expect(
      zoomDirectionForKey(new KeyboardEvent("keydown", { key, shiftKey, metaKey: true }), true),
    ).toBe(direction);
  });

  it("uses Ctrl on Windows/Linux and ignores Alt and composition", () => {
    expect(
      zoomDirectionForKey(new KeyboardEvent("keydown", { key: "+", ctrlKey: true }), false),
    ).toBe("in");
    expect(
      zoomDirectionForKey(new KeyboardEvent("keydown", { key: "+", ctrlKey: true }), true),
    ).toBe(null);
    expect(
      zoomDirectionForKey(
        new KeyboardEvent("keydown", { key: "+", metaKey: true, altKey: true }),
        true,
      ),
    ).toBe(null);
    expect(
      zoomDirectionForKey(
        new KeyboardEvent("keydown", { key: "+", metaKey: true, isComposing: true }),
        true,
      ),
    ).toBe(null);
  });
});
