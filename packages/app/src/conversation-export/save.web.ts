import { isWeb } from "@/constants/platform";

export async function saveConversation(fileName: string, content: string): Promise<void> {
  if (!isWeb) return;
  const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Chromium consumes the blob asynchronously, including in Electron.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
