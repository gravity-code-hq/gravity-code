import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function saveConversation(fileName: string, content: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("File sharing is unavailable on this device.");
  }
  const file = new File(Paths.cache, fileName);
  try {
    file.write(content);
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: fileName,
    });
  } finally {
    if (file.exists) file.delete();
  }
}
