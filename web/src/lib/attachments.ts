// Phone photos are often 4 to 8 MB. Shrink them to at most this many pixels
// on the long side before upload, which keeps them well under the 10 MB
// limit and quick to send over the venue Wi-Fi.
const MAX_SIDE = 2000;
export const MAX_BYTES = 10 * 1024 * 1024;

export type Upload = { blob: Blob; name: string };

// A JPEG copy of a photo, scaled down if it's large. Anything that isn't an
// image the browser can draw (a PDF, or HEIC outside Safari) is sent as is.
export async function prepareUpload(file: File): Promise<Upload> {
  const original = { blob: file, name: file.name || "attachment" };
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return original;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return original;
    return { blob, name: `${original.name.replace(/\.[^.]*$/, "")}.jpg` };
  } catch {
    return original;
  }
}

export const isImage = (extension: string | null, type: string | null) =>
  type === "IMG" || /^(jpe?g|png|gif|webp|heic)$/i.test(extension ?? "");
