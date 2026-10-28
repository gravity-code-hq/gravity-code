// pdf_viewer.mjs reads pdf.js from `globalThis.pdfjsLib`, and pdf.js runs its
// parser in-thread when `globalThis.pdfjsWorker` is set. The sandboxed frame
// has an opaque origin and no URL to load a worker script from, so the worker
// is bundled in. Import pdf.js through this module, ahead of pdf_viewer.mjs.
import * as pdfjsLib from "pdfjs-dist";
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs";

const scope = globalThis as typeof globalThis & {
  pdfjsLib?: typeof pdfjsLib;
  pdfjsWorker?: typeof pdfjsWorker;
};
scope.pdfjsLib = pdfjsLib;
scope.pdfjsWorker = pdfjsWorker;

export { pdfjsLib };
