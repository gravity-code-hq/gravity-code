import { useLayoutEffect, type RefObject } from "react";
import type { TextInput } from "react-native";
import { getCommandTextRanges, type InputCommand } from "./command-ranges";

interface HighlightedInputProps {
  inputRef: RefObject<TextInput | null>;
  commands: readonly InputCommand[];
  revision: number;
  color?: string;
}

// Keep the textarea as the editing and accessibility surface. A matching, noninteractive
// paint layer supplies inline colors without changing text, selection, undo, or IME ownership.
export function useCommandHighlights({
  inputRef,
  commands,
  revision,
  color,
}: HighlightedInputProps) {
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!(input instanceof HTMLTextAreaElement) || !color || commands.length === 0) return;
    const overlay = document.createElement("div");
    overlay.setAttribute("aria-hidden", "true");
    overlay.dataset.testid = "command-text-highlights";
    Object.assign(overlay.style, {
      position: "absolute",
      pointerEvents: "none",
      overflow: "hidden",
    });
    input.before(overlay);
    const originalFill = input.style.webkitTextFillColor;
    let composing = false;

    function paint() {
      if (!(input instanceof HTMLTextAreaElement) || !overlay) return;
      const ranges = getCommandTextRanges(input.value, commands);
      if (composing || ranges.length === 0) {
        overlay.replaceChildren();
        if (input.style.webkitTextFillColor !== originalFill) {
          input.style.webkitTextFillColor = originalFill;
        }
        return;
      }
      const computed = getComputedStyle(input);
      const content = document.createElement("div");
      Object.assign(content.style, {
        boxSizing: "border-box",
        width: `${input.clientWidth}px`,
        minHeight: `${input.clientHeight}px`,
        font: computed.font,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        lineHeight: computed.lineHeight,
        letterSpacing: computed.letterSpacing,
        tabSize: computed.tabSize,
        textAlign: computed.textAlign,
        direction: computed.direction,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        wordBreak: computed.wordBreak,
        padding: computed.padding,
        color: computed.color,
        transform: `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`,
      });
      let offset = 0;
      for (const range of ranges) {
        content.append(input.value.slice(offset, range.start));
        const token = document.createElement("span");
        token.dataset.commandToken = "";
        token.textContent = input.value.slice(range.start, range.end);
        Object.assign(token.style, {
          color,
          backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`,
          borderRadius: "4px",
          boxDecorationBreak: "clone",
        });
        content.append(token);
        offset = range.end;
      }
      content.append(input.value.slice(offset), "\u200b");
      overlay.style.left = `${input.offsetLeft + input.clientLeft}px`;
      overlay.style.top = `${input.offsetTop + input.clientTop}px`;
      overlay.style.width = `${input.clientWidth}px`;
      overlay.style.height = `${input.clientHeight}px`;
      overlay.replaceChildren(content);
      if (input.style.webkitTextFillColor !== "transparent") {
        input.style.webkitTextFillColor = "transparent";
      }
    }
    function startComposition() {
      composing = true;
      paint();
    }
    function endComposition() {
      composing = false;
      paint();
    }
    const resize = new ResizeObserver(paint);
    const attributes = new MutationObserver(paint);
    resize.observe(input);
    attributes.observe(input, { attributes: true, attributeFilter: ["style", "class", "dir"] });
    input.addEventListener("input", paint);
    input.addEventListener("scroll", paint);
    input.addEventListener("compositionstart", startComposition);
    input.addEventListener("compositionend", endComposition);
    paint();
    return () => {
      resize.disconnect();
      attributes.disconnect();
      input.removeEventListener("input", paint);
      input.removeEventListener("scroll", paint);
      input.removeEventListener("compositionstart", startComposition);
      input.removeEventListener("compositionend", endComposition);
      input.style.webkitTextFillColor = originalFill;
      overlay.remove();
    };
  }, [inputRef, commands, revision, color]);
}
