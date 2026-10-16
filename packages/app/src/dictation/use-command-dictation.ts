import { useEffect, useRef } from "react";
import { useComposerKeyboardScope } from "@/composer/keyboard-scope";
import { isWeb } from "@/constants/platform";
import { resolveKeyboardFocusScope } from "@/keyboard/focus-scope";
import { hasActiveWebOverlay } from "@/lib/overlay-root";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { toError } from "@/hooks/use-dictation.shared";
import { createCommandDictation } from "./command-dictation";

interface CommandDictationOptions {
  canStart(): boolean;
  isRecording(): boolean;
  isProcessing: boolean;
  isVoiceActive: boolean;
  readOnly: boolean;
  focus(): void;
  start(): Promise<void>;
  insert(): Promise<void>;
  cancel(): Promise<void>;
  onError(error: Error): void;
}

export function useCommandDictation(options: CommandDictationOptions): void {
  const { isActiveComposer } = useComposerKeyboardScope();
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!isWeb || getShortcutOs() !== "mac" || !isActiveComposer) return;

    function canToggle() {
      const shortcuts = useKeyboardShortcutsStore.getState();
      const blocked =
        shortcuts.capturingShortcut || shortcuts.commandCenterOpen || shortcuts.shortcutsDialogOpen;
      if (blocked || hasActiveWebOverlay() || document.visibilityState !== "visible") return false;
      const scope = resolveKeyboardFocusScope({
        target: document.activeElement,
        commandCenterOpen: false,
      });
      return scope === "message-input" || scope === "other";
    }

    function canStart() {
      const current = latest.current;
      const busy = current.isProcessing || current.isVoiceActive || current.readOnly;
      return !busy && current.canStart();
    }

    const shortcut = createCommandDictation({
      canToggle,
      canStart,
      isRecording: () => latest.current.isRecording(),
      start: async () => {
        latest.current.focus();
        await latest.current.start();
      },
      insert: () => latest.current.insert(),
      cancel: () => latest.current.cancel(),
      onError: (error) => latest.current.onError(toError(error)),
    });
    function handleVisibility() {
      if (document.visibilityState !== "visible") shortcut.blur();
    }

    window.addEventListener("keydown", shortcut.keyDown, true);
    window.addEventListener("keyup", shortcut.keyUp, true);
    window.addEventListener("pointerdown", shortcut.pointerDown, true);
    window.addEventListener("blur", shortcut.blur);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("keydown", shortcut.keyDown, true);
      window.removeEventListener("keyup", shortcut.keyUp, true);
      window.removeEventListener("pointerdown", shortcut.pointerDown, true);
      window.removeEventListener("blur", shortcut.blur);
      document.removeEventListener("visibilitychange", handleVisibility);
      shortcut.dispose();
    };
  }, [isActiveComposer]);
}
