import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EditingTextInput as ComposerTextInput } from "@/components/ui/text-input/text-input.web";
import type { EditingTextInputHandle as ComposerTextInputHandle } from "@/components/ui/text-input";
import type { InputCommand } from "@/components/ui/text-input/command-ranges";

interface MountedInput {
  root: Root;
  container: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  inputRef: React.MutableRefObject<ComposerTextInputHandle | null>;
}

interface TextRecorder {
  changes: string[];
  onChangeText: (text: string) => void;
}

const mountedInputs: MountedInput[] = [];

function mountInput(
  onChangeText: (text: string) => void,
  inputRef: React.MutableRefObject<ComposerTextInputHandle | null> = React.createRef(),
  commands?: readonly InputCommand[],
): MountedInput {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ComposerTextInput
        ref={inputRef}
        initialValue=""
        commands={commands}
        commandHighlightColor="#b45309"
        multiline={true}
        onChangeText={onChangeText}
        testID="composer-input"
      />,
    );
  });

  const textarea = container.querySelector("textarea");
  if (!textarea) {
    throw new Error("Composer text input did not render a textarea");
  }

  const mounted = { root, container, textarea, inputRef };
  mountedInputs.push(mounted);
  return mounted;
}

function dispatchComposition(
  textarea: HTMLTextAreaElement,
  type: "compositionstart" | "compositionend",
) {
  textarea.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
}

function typeFromIme(textarea: HTMLTextAreaElement, text: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!valueSetter) {
    throw new Error("HTML textarea value setter is unavailable");
  }
  valueSetter.call(textarea, text);
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
}

function ignoreTextChange(): void {}

function createTextRecorder(): TextRecorder {
  const changes: string[] = [];
  return {
    changes,
    onChangeText: (text) => changes.push(text),
  };
}

afterEach(() => {
  for (const mounted of mountedInputs.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

describe("ComposerTextInput web IME composition", () => {
  it("paints known commands without changing submitted text, selection, or clear behavior", () => {
    const ref = React.createRef<ComposerTextInputHandle>();
    const mounted = mountInput(ignoreTextChange, ref, [{ name: "review", kind: "command" }]);
    act(() => {
      ref.current?.focus();
      ref.current?.replaceText("/review changes", { start: 15, end: 15 });
    });

    expect(mounted.container.querySelector("[data-command-token]")?.textContent).toBe("/review");
    expect(ref.current?.getText()).toBe("/review changes");
    expect(mounted.textarea.selectionStart).toBe(15);
    expect(mounted.textarea.style.webkitTextFillColor).toBe("transparent");

    act(() => typeFromIme(mounted.textarea, "/review-more changes"));
    expect(mounted.container.querySelector("[data-command-token]")).toBeNull();
    expect(mounted.textarea.style.webkitTextFillColor).toBe("");

    act(() => ref.current?.replaceText("/review "));
    expect(mounted.container.querySelector("[data-command-token]")?.textContent).toBe("/review");
    act(() => ref.current?.reset());
    expect(mounted.container.querySelector("[data-command-token]")).toBeNull();
    expect(ref.current?.getText()).toBe("");
    expect(document.activeElement).toBe(mounted.textarea);
  });

  it("keeps IME candidates visible while command decoration is suspended", () => {
    const ref = React.createRef<ComposerTextInputHandle>();
    const mounted = mountInput(ignoreTextChange, ref, [{ name: "review", kind: "command" }]);
    act(() => ref.current?.replaceText("/review "));
    act(() => {
      dispatchComposition(mounted.textarea, "compositionstart");
      typeFromIme(mounted.textarea, "/review 你好");
    });
    expect(mounted.textarea.style.webkitTextFillColor).toBe("");
    expect(mounted.container.querySelector("[data-command-token]")).toBeNull();
    act(() => dispatchComposition(mounted.textarea, "compositionend"));
    expect(mounted.container.querySelector("[data-command-token]")?.textContent).toBe("/review");
    expect(ref.current?.getText()).toBe("/review 你好");
  });
  it("resets the composer text while preserving focus", () => {
    const mounted = mountInput(ignoreTextChange);
    act(() => {
      mounted.inputRef.current?.focus();
      typeFromIme(mounted.textarea, "line one\nline two");
    });

    act(() => mounted.inputRef.current?.reset());

    expect(mounted.textarea.value).toBe("");
    expect(mounted.inputRef.current?.getText()).toBe("");
    expect(document.activeElement).toBe(mounted.textarea);
  });

  it("keeps locally typed text when its parent rerenders with a stale value", () => {
    const recorder = createTextRecorder();
    const mounted = mountInput(recorder.onChangeText);

    act(() => {
      typeFromIme(mounted.textarea, "locally typed");
      mounted.root.render(
        <ComposerTextInput
          initialValue=""
          multiline={true}
          onChangeText={recorder.onChangeText}
          placeholder="rerender with stale publication"
          testID="composer-input"
        />,
      );
    });

    expect(mounted.textarea.value).toBe("locally typed");
    expect(recorder.changes).toEqual(["locally typed"]);
  });

  it("keeps the DOM-owned candidate during composition and reports the committed text", () => {
    const recorder = createTextRecorder();
    const mounted = mountInput(recorder.onChangeText);

    act(() => {
      dispatchComposition(mounted.textarea, "compositionstart");
      mounted.textarea.value = "你好";
      mounted.root.render(
        <ComposerTextInput
          initialValue=""
          multiline={true}
          onChangeText={recorder.onChangeText}
          placeholder="rerender while composing"
          testID="composer-input"
        />,
      );
    });

    expect(mounted.textarea.value).toBe("你好");

    act(() => {
      dispatchComposition(mounted.textarea, "compositionend");
    });

    expect(recorder.changes).toEqual(["你好"]);
  });

  it("keeps the latest candidate across consecutive compositions", () => {
    const mounted = mountInput(ignoreTextChange);

    act(() => {
      dispatchComposition(mounted.textarea, "compositionstart");
      mounted.textarea.value = "你";
      dispatchComposition(mounted.textarea, "compositionend");
      dispatchComposition(mounted.textarea, "compositionstart");
      mounted.textarea.value = "你好";
      mounted.root.render(
        <ComposerTextInput
          initialValue="你"
          multiline={true}
          onChangeText={ignoreTextChange}
          placeholder="second composition"
          testID="composer-input"
        />,
      );
    });

    expect(mounted.textarea.value).toBe("你好");
  });

  it("defers Korean IME input events until composition commits", () => {
    const changes: string[] = [];
    const mounted = mountInput((text) => changes.push(text));

    act(() => {
      dispatchComposition(mounted.textarea, "compositionstart");
      typeFromIme(mounted.textarea, "ㅎ");
      typeFromIme(mounted.textarea, "하");
      typeFromIme(mounted.textarea, "한");
    });

    expect(changes).toEqual([]);

    act(() => {
      dispatchComposition(mounted.textarea, "compositionend");
    });

    expect(changes).toEqual(["한"]);
  });

  it("reads the live DOM value for send-path text extraction during composition", () => {
    const inputRef = React.createRef<ComposerTextInputHandle>();
    const mounted = mountInput(ignoreTextChange, inputRef);
    let queuedText = "";

    act(() => {
      dispatchComposition(mounted.textarea, "compositionstart");
      typeFromIme(mounted.textarea, "old한");
      queuedText = mounted.inputRef.current?.getText() ?? "";
    });

    expect(queuedText).toBe("old한");
    expect(mounted.textarea.value).toBe("old한");

    act(() => {
      mounted.inputRef.current?.replaceText("");
    });

    expect(mounted.textarea.value).toBe("");
  });
});
