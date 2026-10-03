// Safari can support a photo in <img> even when createImageBitmap rejects it.
// Decode locally and release the full-resolution source before moving to the next file.
export async function imageToScanData(
  file: File,
  language: "en" | "ja" = "en",
): Promise<string> {
  let source: CanvasImageSource;
  let width: number, height: number;
  let release: () => void = () => {};
  try {
    if (typeof createImageBitmap !== "function")
      throw Error("Bitmap decoder unavailable");
    const bitmap = await createImageBitmap(file);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
    release = () => bitmap.close();
  } catch {
    const url = URL.createObjectURL(file),
      image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(Error("Cannot decode image"));
        image.src = url;
      });
    } catch {
      URL.revokeObjectURL(url);
      throw Error(
        language === "ja"
          ? `「${file.name}」を読み込めません。写真のスクリーンショットをPNG/JPEGでアップロードしてください。`
          : `Cannot read “${file.name}” on this browser. Take a screenshot of the photo and upload the PNG/JPEG screenshot instead.`,
      );
    }
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
    release = () => {
      image.src = "";
      URL.revokeObjectURL(url);
    };
  }
  try {
    if (!width || !height) throw Error("Image has no dimensions");
    const scale = Math.min(1, 2000 / Math.max(width, height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("Image conversion unavailable");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.85);
    canvas.width = 0;
    canvas.height = 0;
    if (!data.startsWith("data:image/jpeg;base64,"))
      throw Error("Image conversion failed");
    return data;
  } finally {
    release();
  }
}
