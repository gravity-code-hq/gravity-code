import { setImageAsync } from "expo-clipboard";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

export async function copyImage(uri: string): Promise<void> {
  const context = ImageManipulator.manipulate(uri);
  let image: Awaited<ReturnType<typeof context.renderAsync>> | null = null;
  try {
    image = await context.renderAsync();
    const result = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
    if (!result.base64) throw new Error("Image conversion failed");
    await setImageAsync(result.base64);
  } finally {
    image?.release();
    context.release();
  }
}
