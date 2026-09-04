/**
 * Downscales a picture in the browser before it is uploaded.
 *
 * This is the single largest bandwidth item in the app. A teacher's phone photo
 * is easily 4 MB, and every one of 80 students downloads it: 320 MB for one
 * question. Capped and re-encoded it lands around 150–250 KB, so the same
 * question costs ~20 MB instead.
 *
 * Done with the platform's own decoders (`createImageBitmap` + canvas), so it
 * adds no dependency and keeps the bytes off the wire in the first place. The
 * server re-encodes again on arrival (apps/server/http/images.ts) — that is the
 * guarantee; this is the optimisation, and it also means the upload itself is
 * quick on a school's uplink.
 */

/** Longest edge, in pixels. 1600 still looks sharp on a classroom projector. */
const MAX_DIMENSION = 1600;
const QUALITY = 0.82;
/** Below this, re-encoding usually makes the file bigger, not smaller. */
const SKIP_BELOW_BYTES = 150 * 1024;

/** Animated GIFs would lose their animation, so they pass through untouched. */
const PASSTHROUGH_TYPES = new Set(["image/gif"]);

function canEncode(type: string): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  return canvas.toDataURL(type).startsWith(`data:${type}`);
}

let webpSupported: boolean | null = null;
function supportsWebp(): boolean {
  if (webpSupported === null) webpSupported = canEncode("image/webp");
  return webpSupported;
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export interface DownscaleResult {
  file: File;
  /** True when the image was actually re-encoded. */
  changed: boolean;
  originalBytes: number;
}

export async function downscaleImage(
  input: File,
  maxDimension = MAX_DIMENSION,
): Promise<DownscaleResult> {
  const originalBytes = input.size;
  const unchanged = { file: input, changed: false, originalBytes };

  if (PASSTHROUGH_TYPES.has(input.type)) return unchanged;
  if (input.size < SKIP_BELOW_BYTES) return unchanged;

  let bitmap: ImageBitmap;
  try {
    // "from-image" applies EXIF orientation — without it, photos taken in
    // portrait on a phone come out rotated.
    bitmap = await createImageBitmap(input, { imageOrientation: "from-image" });
  } catch {
    return unchanged; // unreadable or unsupported — let the server decide
  }

  try {
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    // WebP is preferred: it compresses best and keeps an alpha channel. Without
    // it, a source that may have transparency must be left alone — re-encoding
    // it as JPEG would turn transparent pixels black.
    const mayHaveAlpha = input.type !== "image/jpeg";
    let type: string;
    if (supportsWebp()) type = "image/webp";
    else if (mayHaveAlpha) return unchanged;
    else type = "image/jpeg";

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return unchanged;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await toBlob(canvas, type, QUALITY);
    // Re-encoding is not guaranteed to win (an already-optimised PNG can grow).
    if (!blob || blob.size >= input.size) return unchanged;

    const ext = type === "image/webp" ? "webp" : "jpg";
    const base = input.name.replace(/\.[^.]+$/, "") || "image";
    return {
      file: new File([blob], `${base}.${ext}`, { type }),
      changed: true,
      originalBytes,
    };
  } finally {
    bitmap.close();
  }
}

export function formatBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(n / 1024)} KB`;
}
