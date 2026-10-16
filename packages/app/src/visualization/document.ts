import { visualizationRuntime, visualizationStyles } from "./runtime.gen";
import type { VisualizationLabels } from "./runtime";

const measurementScript = `document.addEventListener('DOMContentLoaded', () => {
  let previous = 0;
  new ResizeObserver(() => {
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    if (height === previous || height <= 0) return;
    previous = height;
    const message = { type: 'visualization-height', height };
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else parent.postMessage(message, '*');
  }).observe(document.body);
}, { once: true });`;

export function createVisualizationDocument(fragment: string, labels: VisualizationLabels): string {
  const serializedLabels = JSON.stringify(labels).replace(/</g, "\\u003c");
  return `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${visualizationStyles}</style><script>${visualizationRuntime}\n__gravityInstallVisualization(${serializedLabels});${measurementScript}</script>${fragment}`;
}
