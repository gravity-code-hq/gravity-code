import { pdfjsLib } from "./globals";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import { parsePdfRuntimeCommand, type PdfRuntimeMessage } from "./messages";

// pdf.js's own "auto" zoom: fit the page width, but don't blow a portrait page
// past 125% on a wide pane.
const MAX_FIT_SCALE = 1.25;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
// Matches the horizontal gutter in the runtime CSS.
const PAGE_GUTTER = 24;
const CSS_UNITS_PER_PDF_POINT = 96 / 72;

const container = document.getElementById("viewerContainer") as HTMLDivElement;
const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const viewer = new PDFViewer({
  container,
  eventBus,
  linkService,
  removePageBorders: true,
});
linkService.setViewer(viewer);

let revision = 0;
let loadingTask: PDFDocumentLoadingTask | null = null;
let fit = true;
let firstPageWidth = 0;
let restorePage: number | null = null;

function sendToHost(message: PdfRuntimeMessage): void {
  window.parent.postMessage(message, "*");
}

function publishState(): void {
  if (!viewer.pdfDocument) return;
  sendToHost({
    type: "state",
    revision,
    page: viewer.currentPageNumber,
    pageCount: viewer.pagesCount,
    scale: viewer.currentScale,
    fit,
  });
}

function applyFit(): void {
  if (!firstPageWidth) return;
  const available = container.clientWidth - PAGE_GUTTER * 2;
  viewer.currentScale = Math.max(MIN_SCALE, Math.min(MAX_FIT_SCALE, available / firstPageWidth));
}

function zoom(steps: number, origin?: [number, number], scaleFactor?: number): void {
  fit = false;
  viewer.updateScale(
    scaleFactor === undefined ? { steps, origin } : { scaleFactor, origin, drawingDelay: 400 },
  );
  if (viewer.currentScale < MIN_SCALE) viewer.currentScale = MIN_SCALE;
  if (viewer.currentScale > MAX_SCALE) viewer.currentScale = MAX_SCALE;
}

async function load(nextRevision: number, data: Uint8Array): Promise<void> {
  revision = nextRevision;
  // A reload of the same file (it changed on disk) keeps the reader's place.
  restorePage = viewer.pdfDocument ? viewer.currentPageNumber : null;
  const previous = loadingTask;
  loadingTask = pdfjsLib.getDocument({ data, useWasm: false, enableXfa: false });
  const task = loadingTask;
  let pdfDocument: PDFDocumentProxy;
  try {
    pdfDocument = await task.promise;
  } catch {
    if (task === loadingTask) sendToHost({ type: "loadError", revision: nextRevision });
    return;
  }
  if (task !== loadingTask) {
    void task.destroy();
    return;
  }
  const firstPage = await pdfDocument.getPage(1);
  firstPageWidth = firstPage.getViewport({ scale: 1 }).width * CSS_UNITS_PER_PDF_POINT;
  viewer.setDocument(pdfDocument);
  linkService.setDocument(pdfDocument, null);
  void previous?.destroy();
}

eventBus.on("pagesinit", () => {
  if (fit) applyFit();
  if (restorePage !== null) {
    viewer.currentPageNumber = Math.min(restorePage, viewer.pagesCount);
    restorePage = null;
  } else {
    // Rescaling scrolls page 1's top edge flush with the frame; show the gutter.
    container.scrollTop = 0;
  }
  publishState();
});
eventBus.on("pagechanging", publishState);
eventBus.on("scalechanging", publishState);

new ResizeObserver(() => {
  if (fit) applyFit();
}).observe(container);

// Trackpad pinch arrives as ctrl+wheel; Cmd/Ctrl+scroll is the mouse equivalent.
container.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoom(0, [event.clientX, event.clientY], Math.exp(-event.deltaY / 100));
  },
  { passive: false },
);

// The frame has no popup permission, so external links go through the host's
// opener, which owns the scheme allowlist. In-document links stay with pdf.js.
document.addEventListener("click", (event) => {
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("#")) return;
  event.preventDefault();
  sendToHost({ type: "openLink", url: anchor.href });
});

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const command = parsePdfRuntimeCommand(event.data);
  if (!command) return;
  if (command.type === "load") {
    void load(command.revision, command.data);
    return;
  }
  if (command.action === "fit") {
    fit = true;
    applyFit();
    return;
  }
  zoom(command.action === "in" ? 1 : -1);
});

sendToHost({ type: "bridgeReady" });
