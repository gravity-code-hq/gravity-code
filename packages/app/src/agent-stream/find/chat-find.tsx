import type { RefObject } from "react";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "../strategy";

export interface ChatFindProps {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
  viewportRef: RefObject<StreamViewportHandle | null>;
  visibleItemIds: ReadonlySet<string>;
  revealLoadedItem: (itemId: string) => boolean;
  isActive: boolean;
}

// Find-in-chat opens from the keyboard and paints with the CSS Highlight API, so it is
// web-only. Native has no widget to render.
export function ChatFind(_props: ChatFindProps): null {
  return null;
}
