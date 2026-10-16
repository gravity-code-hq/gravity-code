import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { page, userEvent } from "vitest/browser";
import { EditorView } from "@codemirror/view";
import { editorBaseExtensions, editorTheme } from "./extensions.web";
import { afterEach, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@/i18n/i18next";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { darkTheme } from "@/styles/theme";
import { dispatchContentZoom } from "@/zoom/target.web";
import { FileEditorModel } from "./model";
import { FileEditorView } from "./view.web";
import type { EditorVisualTheme } from "./extensions.web";

let editorView: EditorView | null = null;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let model: FileEditorModel | null = null;
const toast = { show: vi.fn(), copied: vi.fn(), error: vi.fn() };
function noop() {}

const theme: EditorVisualTheme = {
  uiTheme: darkTheme,
  colorScheme: "dark",
  background: darkTheme.colors.surface0,
  foreground: darkTheme.colors.foreground,
  cursor: darkTheme.colors.terminal.cursor,
  foregroundMuted: darkTheme.colors.foregroundMuted,
  border: darkTheme.colors.border,
  selection: darkTheme.colors.terminal.selectionBackground,
  monoFont: "monospace",
  codeFontSize: 14,
  syntax: darkTheme.colors.syntax,
};
const location = { path: "example.ts" };

afterEach(() => {
  editorView?.destroy();
  editorView = null;
  root?.unmount();
  root = null;
  model?.dispose();
  host?.remove();
});

it("zooms a real source editor without changing its contents or surrounding interface", async () => {
  vi.stubGlobal("React", React);
  await page.viewport(900, 600);
  host = document.createElement("div");
  host.style.cssText = "display:flex;width:800px;height:400px";
  document.body.append(host);
  root = createRoot(host);
  model = new FileEditorModel({
    file: {
      content: 'const greeting = "Hello, Gravity";\nconsole.log(greeting);',
      hasBom: false,
      version: {
        status: "ready",
        cwd: "/workspace",
        path: "example.ts",
        size: 56,
        modifiedAt: "2026-10-07T00:00:00Z",
      },
    },
    session: {
      async write() {
        throw new Error("Zoom must not save the file");
      },
    },
  });
  const initialContent = model.getSnapshot().content;
  const mountedModel = model;
  flushSync(() =>
    root?.render(
      <I18nextProvider i18n={i18n}>
        <ToastApiProvider api={toast}>
          <button type="button" data-testid="sidebar">
            Workspace
          </button>
          <FileEditorView
            model={mountedModel}
            filename="example.ts"
            location={location}
            navigationRevision={0}
            vimEnabled={false}
            theme={theme}
            onCursorChange={noop}
            onVimModeChange={noop}
          />
        </ToastApiProvider>
      </I18nextProvider>,
    ),
  );
  const content = host.querySelector(".cm-content");
  const editor = host.querySelector(".cm-editor");
  const sidebar = host.querySelector("button");
  if (!(content instanceof HTMLElement) || !(editor instanceof HTMLElement) || !sidebar)
    throw new Error("Editor did not mount");
  const sidebarWidth = sidebar.getBoundingClientRect().width;
  content.focus();
  flushSync(() => {
    expect(dispatchContentZoom("in")).toBe(true);
    expect(dispatchContentZoom("in")).toBe(true);
  });
  await expect.poll(() => getComputedStyle(editor).fontSize).toBe("16px");
  expect(sidebar.getBoundingClientRect().width).toBe(sidebarWidth);
  expect(toast.show).toHaveBeenLastCalledWith(
    "Editor text: 16 px",
    expect.objectContaining({ durationMs: 1500 }),
  );
  await page.screenshot({ path: "/tmp/gravity-zoom-editor.png" });
  flushSync(() => {
    expect(dispatchContentZoom("reset")).toBe(true);
  });
  await expect.poll(() => getComputedStyle(editor).fontSize).toBe("14px");
  expect(model.getSnapshot().content).toBe(initialContent);
  expect(model.getSnapshot().status).toBe("clean");
  sidebar.focus();
  expect(dispatchContentZoom("in")).toBe(false);
});

async function mountSearchEditor(content = "street Street streets\nstreet") {
  await page.viewport(900, 600);
  host = document.createElement("div");
  host.style.cssText = "display:flex;width:800px;height:400px";
  document.body.append(host);
  editorView = new EditorView({
    parent: host,
    doc: content,
    extensions: [...editorBaseExtensions(noop), editorTheme(theme)],
  });
  editorView.dom.style.width = "100%";
  editorView.focus();
  const modifier = navigator.platform.includes("Mac") ? "Meta" : "Control";
  await userEvent.keyboard(`{${modifier}>}f{/${modifier}}`);
  return editorView;
}

it("finds as you type in a floating widget and navigates matches without moving the editor", async () => {
  const view = await mountSearchEditor();
  const contentTop = view.contentDOM.getBoundingClientRect().top;
  const find = page.getByRole("textbox", { name: "Find", exact: true });
  await find.fill("street");
  await expect.element(page.getByRole("status")).toHaveTextContent("1 of 4");
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
    "street",
  );
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("status")).toHaveTextContent("2 of 4");
  await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
  await expect.element(page.getByRole("status")).toHaveTextContent("1 of 4");
  await page.getByRole("button", { name: "Previous match", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("4 of 4");
  await expect
    .element(page.getByRole("textbox", { name: "Replace", exact: true }))
    .not.toBeInTheDocument();
  await page.screenshot({ path: "/tmp/gravity-editor-find.png" });
  await find.click();
  await userEvent.keyboard("{Escape}");
  await expect.element(find).not.toBeInTheDocument();
  expect(view.hasFocus).toBe(true);
  expect(view.contentDOM.getBoundingClientRect().top).toBe(contentTop);
});

it("applies case, word, and regex options and recovers from invalid queries", async () => {
  await mountSearchEditor();
  const find = page.getByRole("textbox", { name: "Find", exact: true });
  const count = page.getByRole("status");
  await find.fill("street");
  await page.getByRole("button", { name: "Match case", exact: true }).click();
  await expect.element(count).toHaveTextContent("1 of 3");
  await page.getByRole("button", { name: "Match whole word", exact: true }).click();
  await expect.element(count).toHaveTextContent("1 of 2");
  await page.getByRole("button", { name: "Use regular expression", exact: true }).click();
  await find.fill("[");
  await expect.element(count).toHaveTextContent("Invalid regex");
  await expect.element(find).toHaveAttribute("aria-invalid", "true");
  await expect
    .element(page.getByRole("button", { name: "Next match", exact: true }))
    .toBeDisabled();
  await find.fill("str[a-z]+");
  await expect.element(count).toHaveTextContent("1 of 3");
  await find.fill("missing");
  await expect.element(count).toHaveTextContent("No results");
  await find.fill("");
  await expect.element(count).toHaveTextContent("");
});

it("replaces regex captures and keeps replacement undoable", async () => {
  const view = await mountSearchEditor("item1 item2 item3");
  const find = page.getByRole("textbox", { name: "Find", exact: true });
  await page.getByRole("button", { name: "Toggle replace" }).click();
  await page.getByRole("button", { name: "Use regular expression" }).click();
  await find.fill("item(\\d)");
  await page.getByRole("textbox", { name: "Replace", exact: true }).fill("value$1");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  expect(view.state.doc.toString()).toBe("value1 item2 item3");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  expect(view.state.doc.toString()).toBe("value1 value2 value3");
  await expect.element(page.getByRole("status")).toHaveTextContent("No results");
  await page.getByRole("button", { name: "Close find" }).click();
  const modifier = navigator.platform.includes("Mac") ? "Meta" : "Control";
  await userEvent.keyboard(`{${modifier}>}z{/${modifier}}`);
  expect(view.state.doc.toString()).toBe("value1 item2 item3");
});

it("keeps the widget at the top right and inside a narrow pane", async () => {
  const view = await mountSearchEditor(
    Array.from({ length: 50 }, (_, i) => `const item${i} = "Gravity";`).join("\n"),
  );
  const find = page.getByRole("textbox", { name: "Find", exact: true });
  await find.fill("Gravity");
  const widget = view.dom.querySelector(".gravity-find");
  if (!widget || !host) throw new Error("Find widget did not mount");
  const editorBounds = view.dom.getBoundingClientRect();
  const bounds = widget.getBoundingClientRect();
  expect(bounds.right).toBeLessThan(editorBounds.right);
  expect(bounds.left).toBeGreaterThan(editorBounds.left + 100);
  expect(bounds.top).toBeGreaterThan(editorBounds.top);
  await page.screenshot({ path: "/tmp/gravity-editor-find.png" });
  host.style.width = "360px";
  await expect.poll(() => widget.getBoundingClientRect().right).toBeLessThanOrEqual(360);
  expect(widget.scrollWidth).toBeLessThanOrEqual(widget.clientWidth);
  expect(view.dom.querySelector("input")?.getBoundingClientRect().width).toBeGreaterThan(140);
  await page.screenshot({ path: "/tmp/gravity-editor-find-narrow.png" });
});
