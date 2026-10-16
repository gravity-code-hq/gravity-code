import { useEffect } from "react";
import { getDesktopHost } from "@/desktop/host";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { dispatchContentZoom, zoomDirectionForKey } from "./target.web";
import { isZoomDirection } from "./text-size";

export function useZoomShortcuts(): void {
  useEffect(() => {
    const host = getDesktopHost();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (host?.events?.on) {
      void Promise.resolve(
        host.events.on("zoom", (direction) => {
          if (!isZoomDirection(direction)) return;
          if (useKeyboardShortcutsStore.getState().capturingShortcut) return;
          if (!dispatchContentZoom(direction)) void host.menu?.zoomApp?.(direction);
        }),
      ).then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
        return undefined;
      });
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || useKeyboardShortcutsStore.getState().capturingShortcut) return;
      const direction = zoomDirectionForKey(event, getShortcutOs() === "mac");
      if (!direction) return;
      const handled = dispatchContentZoom(direction);
      if (handled || host) {
        event.preventDefault();
        event.stopPropagation();
        if (!handled) void host?.menu?.zoomApp?.(direction);
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      disposed = true;
      unlisten?.();
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);
}
