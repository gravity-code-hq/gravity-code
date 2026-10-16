import { useCallback, useRef } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import { isZoomDirection, type ZoomDirection } from "./text-size";

const CONTENT_ZOOM_EVENT = "gravity:content-zoom";

export function dispatchContentZoom(direction: ZoomDirection): boolean {
  const event = new CustomEvent(CONTENT_ZOOM_EVENT, {
    bubbles: true,
    cancelable: true,
    detail: direction,
  });
  document.activeElement?.dispatchEvent(event);
  return event.defaultPrevented;
}

export function bindZoomTarget(
  host: HTMLElement,
  selector: string,
  onZoom: (direction: ZoomDirection) => void,
): () => void {
  function handleZoom(event: Event) {
    if (!(event instanceof CustomEvent) || !isZoomDirection(event.detail)) return;
    if (!(event.target instanceof Element)) return;
    const content = event.target.closest(selector);
    if (!content || !host.contains(content)) return;
    event.preventDefault();
    event.stopPropagation();
    onZoom(event.detail);
  }
  host.addEventListener(CONTENT_ZOOM_EVENT, handleZoom);
  return () => host.removeEventListener(CONTENT_ZOOM_EVENT, handleZoom);
}

export function useZoomTarget(selector: string, onZoom: (direction: ZoomDirection) => void) {
  const handleZoom = useStableEvent(onZoom);
  const unbindRef = useRef<(() => void) | null>(null);
  return useCallback(
    (node: unknown) => {
      unbindRef.current?.();
      unbindRef.current =
        node instanceof HTMLElement ? bindZoomTarget(node, selector, handleZoom) : null;
    },
    [selector, handleZoom],
  );
}

export function zoomDirectionForKey(event: KeyboardEvent, isMac: boolean): ZoomDirection | null {
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  const extraModifier = isMac ? event.ctrlKey : event.metaKey;
  if (!modifier || extraModifier || event.altKey || event.isComposing) return null;
  if (event.key === "=" || event.key === "+") return "in";
  if (event.shiftKey) return null;
  if (event.key === "-") return "out";
  if (event.key === "0") return "reset";
  return null;
}
