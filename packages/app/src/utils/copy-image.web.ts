async function imageAsPng(uri: string): Promise<Blob> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = uri;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image conversion unavailable");
  context.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Image conversion failed"));
    }, "image/png");
  });
}

export async function copyImage(uri: string): Promise<void> {
  // Start the clipboard write in the click handler; Safari requires user activation
  // before the asynchronous image decode completes.
  await navigator.clipboard.write([new ClipboardItem({ "image/png": imageAsPng(uri) })]);
}
