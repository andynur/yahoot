/**
 * Re-encodes an uploaded picture before it ever touches disk.
 *
 * Why this exists on the server at all, when the editor already downscales in
 * the browser (apps/web/src/image.ts): that path is an optimisation, this one is
 * the guarantee. A question image is downloaded by every student in the room, so
 * one 8 MB photo that slipped past the editor — an old phone browser without
 * `createImageBitmap`, a paste, a direct API call — costs a class of 80 well
 * over half a gigabyte off a cheap VPS for a single question. After this it
 * costs a few hundred KB, whatever the client did or didn't do.
 *
 * Uses `Bun.Image` (Bun 1.4+): statically-linked libjpeg-turbo / libspng /
 * libwebp with SIMD resize, built into the runtime. No `sharp`, no native module
 * to install, no platform-specific prebuilt binary to go wrong on a school's
 * VPS — which matters more here than raw speed.
 *
 * Decoding also *authenticates* the upload: a file is an image because its
 * pixels decoded, not because the browser said `image/png` in the form part.
 */
import { HttpError } from "./respond";

/** Longest edge. 1600 still looks sharp projected onto a classroom wall. */
const MAX_DIMENSION = 1600;
/** WebP quality. 80 is the usual "can't tell without pixel-peeping" point. */
const QUALITY = 80;
/**
 * Refuse absurd canvases before any pixel buffer is allocated. 40 MP covers
 * every phone camera a teacher will realistically use (a 40 MP decode is still
 * ~120 MB of RGB, which is why uploads are serialised below).
 */
const MAX_PIXELS = 40_000_000;

/**
 * GIFs pass through untouched. `Bun.Image` decodes only the first frame and has
 * no GIF encoder, so re-encoding one would silently kill the animation — the
 * single reason a teacher picks a GIF in the first place.
 */
const PASSTHROUGH_FORMATS = new Set(["gif"]);

/**
 * Formats we are willing to serve back byte-for-byte. Everything else that
 * decodes is fine as *input* — it just leaves here as WebP.
 */
const STORABLE: Record<string, { ext: string; contentType: string }> = {
  jpeg: { ext: "jpg", contentType: "image/jpeg" },
  png: { ext: "png", contentType: "image/png" },
  webp: { ext: "webp", contentType: "image/webp" },
  gif: { ext: "gif", contentType: "image/gif" },
};

export interface ProcessedImage {
  bytes: Uint8Array;
  /** File extension to store it under, without the dot. */
  ext: string;
  contentType: string;
  width: number;
  height: number;
  /** False when the original was kept (GIF, or already smaller than the re-encode). */
  reencoded: boolean;
  originalBytes: number;
}

/**
 * Decoding a large photo allocates its full RGB buffer, so N simultaneous
 * uploads cost N × ~120 MB — enough to OOM the 1 GB VPS this app is meant to
 * run on. Uploads are an authoring action a teacher does a handful of times, so
 * one at a time is free in practice and removes the failure mode entirely.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  // Keep the chain alive regardless of outcome; never let it reject.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

/** Turn a decode failure into the status that actually describes it. */
function decodeFailure(err: unknown): HttpError {
  switch (errorCode(err)) {
    case "ERR_IMAGE_TOO_MANY_PIXELS":
      return new HttpError(422, "image resolution is too large");
    case "ERR_IMAGE_FORMAT_UNSUPPORTED":
    case "ERR_IMAGE_UNKNOWN_FORMAT":
      return new HttpError(415, "only PNG, JPEG, WebP or GIF images");
    default:
      return new HttpError(422, "could not read that image");
  }
}

export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  return serialize(async () => {
    const options = { maxPixels: MAX_PIXELS, autoOrient: true };

    let meta: { width: number; height: number; format: string };
    try {
      meta = await new Bun.Image(input, options).metadata();
    } catch (err) {
      throw decodeFailure(err);
    }

    // Anything Bun could decode is acceptable input — BMP, TIFF, a HEIC off an
    // iPhone — because it leaves here as WebP regardless. `storable` is only
    // about whether we could hand the *original* bytes back instead.
    const storable = STORABLE[meta.format];

    // Used for GIFs and for the case where our re-encode came back bigger.
    const keepOriginal = (): ProcessedImage => ({
      bytes: input,
      ext: storable!.ext,
      contentType: storable!.contentType,
      width: meta.width,
      height: meta.height,
      reencoded: false,
      originalBytes: input.byteLength,
    });

    if (storable && PASSTHROUGH_FORMATS.has(meta.format)) return keepOriginal();

    let out: Uint8Array;
    try {
      out = await new Bun.Image(input, options)
        // `autoOrient` has already straightened EXIF-rotated phone photos, so
        // the cap applies to what the student will actually see.
        .resize(MAX_DIMENSION, MAX_DIMENSION, {
          fit: "inside",
          withoutEnlargement: true,
        })
        // WebP everywhere: best ratio of the three encoders, and unlike JPEG it
        // keeps an alpha channel, so a transparent PNG doesn't gain a black box.
        .webp({ quality: QUALITY })
        .bytes();
    } catch (err) {
      throw decodeFailure(err);
    }

    // Re-encoding is not guaranteed to win — a small, already-optimised WebP can
    // come back bigger. Ship whichever is smaller, as long as we can serve the
    // original's format back.
    if (storable && out.byteLength >= input.byteLength) return keepOriginal();

    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(meta.width, meta.height),
    );
    return {
      bytes: out,
      ext: "webp",
      contentType: "image/webp",
      width: Math.max(1, Math.round(meta.width * scale)),
      height: Math.max(1, Math.round(meta.height * scale)),
      reencoded: true,
      originalBytes: input.byteLength,
    };
  });
}
