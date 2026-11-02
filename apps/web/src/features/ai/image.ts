/** Longest edge of an uploaded meal photo after the client-side resize. */
export const MAX_EDGE = 1280;
export const JPEG_QUALITY = 0.8;

export interface ResizedImage {
  /** Base64 of the JPEG, without the `data:` prefix. */
  base64: string;
  mimeType: 'image/jpeg';
  /** Decoded size of the JPEG, checked against the server's `AI_MAX_IMAGE_BYTES` before upload. */
  bytes: number;
  /** Object URL for the thumbnail; the caller revokes it. */
  previewUrl: string;
}

export const DECODE_ERROR = 'Could not read this photo. Try a JPEG or PNG.';

/** Scales a size down (never up) so the longer edge is at most `maxEdge`, keeping the ratio. */
export function scaleToFit(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const factor = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/** Decoded size of base64 text: three bytes per four characters minus the padding. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Re-encodes a picked or captured photo as a JPEG of at most 1280 px (q 0.8): a phone camera's
 * 12 MP shot becomes a few hundred kilobytes, well under the 4 MB limit and plenty for the model.
 * Formats the browser cannot decode (HEIC on Chrome) fail with a readable message.
 */
export async function resizeImageFile(file: File): Promise<ResizedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(DECODE_ERROR);
  }
  try {
    const { width, height } = scaleToFit(bitmap.width, bitmap.height, MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(DECODE_ERROR);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) throw new Error(DECODE_ERROR);
    const base64 = await blobToBase64(blob);
    return {
      base64,
      mimeType: 'image/jpeg',
      bytes: blob.size,
      previewUrl: URL.createObjectURL(blob),
    };
  } finally {
    bitmap.close();
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(DECODE_ERROR));
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      const comma = url.indexOf(',');
      if (comma === -1) {
        reject(new Error(DECODE_ERROR));
        return;
      }
      resolve(url.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}
