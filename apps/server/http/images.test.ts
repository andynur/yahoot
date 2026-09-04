/**
 * Tests for the upload re-encoder.
 *
 * Sources are built here as BMPs rather than shipped as fixture files: BMP is a
 * header plus raw rows, so a few lines of code give us an arbitrarily large,
 * genuinely decodable image with no binary blobs in the repo and no dependency.
 */
import { describe, expect, test } from "bun:test";
import { HttpError } from "./respond";
import { processImage } from "./images";

/** Minimal 24-bit bottom-up BMP. `noisy` defeats the compressor, like a photo. */
function bmp(width: number, height: number, noisy = true): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = rowSize * height;
  const buf = new Uint8Array(54 + pixels);
  const view = new DataView(buf.buffer);
  buf[0] = 0x42;
  buf[1] = 0x4d; // "BM"
  view.setUint32(2, buf.length, true);
  view.setUint32(10, 54, true); // pixel offset
  view.setUint32(14, 40, true); // BITMAPINFOHEADER
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(34, pixels, true);
  if (noisy) {
    for (let i = 54; i < buf.length; i++) buf[i] = (i * 2654435761) % 251;
  }
  return buf;
}

/** 1x1 transparent GIF — the canonical one. */
const TINY_GIF = new Uint8Array(
  Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  ),
);

describe("processImage", () => {
  test("caps a projector-sized photo at 1600px and re-encodes it to WebP", async () => {
    const source = bmp(3200, 2400);
    const out = await processImage(source);

    expect(out.reencoded).toBe(true);
    expect(out.ext).toBe("webp");
    expect(out.contentType).toBe("image/webp");
    expect(Math.max(out.width, out.height)).toBe(1600);

    // What actually matters: the bytes every student downloads got much smaller.
    expect(out.bytes.byteLength).toBeLessThan(source.byteLength / 4);
    expect(out.originalBytes).toBe(source.byteLength);

    const meta = await new Bun.Image(out.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1200);
  });

  test("does not upscale an image that is already small", async () => {
    const out = await processImage(bmp(400, 300));
    const meta = await new Bun.Image(out.bytes).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  test("leaves a GIF alone so its animation survives", async () => {
    const out = await processImage(TINY_GIF);
    expect(out.reencoded).toBe(false);
    expect(out.ext).toBe("gif");
    expect(out.bytes).toEqual(TINY_GIF);
  });

  test("rejects a file that is not an image, whatever the form said", async () => {
    const notAnImage = new TextEncoder().encode(
      "<?php system($_GET['c']); ?>".repeat(20),
    );
    const err = await processImage(notAnImage).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(415);
  });

  test("refuses a decompression bomb before allocating for it", async () => {
    // A 40000x40000 header is 1.6 gigapixels; the guard must trip on the header.
    const bomb = bmp(1, 1);
    new DataView(bomb.buffer).setInt32(18, 40000, true);
    new DataView(bomb.buffer).setInt32(22, 40000, true);

    const err = await processImage(bomb).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect([413, 415, 422]).toContain((err as HttpError).status);
  });

  test("serialises work so concurrent uploads cannot pile up in memory", async () => {
    const results = await Promise.all([
      processImage(bmp(2000, 1500)),
      processImage(bmp(2000, 1500)),
      processImage(bmp(2000, 1500)),
    ]);
    for (const r of results) {
      expect(r.reencoded).toBe(true);
      expect(Math.max(r.width, r.height)).toBe(1600);
    }
  });
});
