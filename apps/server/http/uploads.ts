/**
 * Image uploads for "text + image" questions (and for a quiz's background).
 *
 *   POST /api/uploads   (teacher only, multipart form, field name "file")
 *   GET  /uploads/:file  — serves what was saved
 *
 * Everything that arrives is re-encoded by http/images.ts before it is written,
 * so what lands on disk is a capped WebP a phone can pull down instantly. The
 * declared MIME type is not trusted: the decode decides whether this is an image.
 *
 * Files land on local disk under apps/server/uploads/. That's fine for a single
 * classroom server; a multi-instance deploy would swap this for object storage.
 * Teachers can also skip uploading and paste an external image URL instead.
 */
import { mkdir } from "node:fs/promises";
import { logInfo } from "../log";
import { processImage } from "./images";
import { HttpError, json, requireTeacher, route } from "./respond";

const UPLOAD_DIR = new URL("../uploads/", import.meta.url).pathname;
/**
 * Ceiling on what we will even attempt to decode. The editor downscales in the
 * browser first (apps/web/src/image.ts), so a normal upload arrives a few
 * hundred KB; this leaves room for a raw phone photo from a client that skipped
 * that path, while still bounding the memory one request can cost us.
 */
const MAX_BYTES = 10 * 1024 * 1024;

const CACHE_FOREVER = "public, max-age=31536000, immutable";

/** Extensions processImage can produce — the whole set of files we ever store. */
const SERVE_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

await mkdir(UPLOAD_DIR, { recursive: true });

const upload = route(async (req) => {
  await requireTeacher(req);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "expected a multipart form");
  }

  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(422, "no file field");
  if (file.size === 0) throw new HttpError(422, "file is empty");
  if (file.size > MAX_BYTES)
    throw new HttpError(413, "image must be under 10 MB");

  const processed = await processImage(await file.bytes());

  const name = `${crypto.randomUUID()}.${processed.ext}`;
  await Bun.write(UPLOAD_DIR + name, processed.bytes);

  logInfo("upload_image", {
    name,
    originalBytes: processed.originalBytes,
    storedBytes: processed.bytes.byteLength,
    dimensions: `${processed.width}x${processed.height}`,
    reencoded: processed.reencoded,
  });

  return json(
    { url: `/uploads/${name}`, bytes: processed.bytes.byteLength },
    201,
  );
});

const serve = route<"/uploads/:file">(async (req) => {
  // basename only — never let a path escape the upload dir
  const name = req.params.file.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!name || name.startsWith(".")) throw new HttpError(404, "not found");

  const type = SERVE_TYPE[name.split(".").pop() ?? ""];
  if (!type) throw new HttpError(404, "not found");

  const file = Bun.file(UPLOAD_DIR + name);
  if (!(await file.exists())) throw new HttpError(404, "not found");

  return new Response(file, {
    headers: {
      // Named explicitly rather than sniffed from the extension by Bun.file, so
      // a file can only ever be served as one of the four image types above.
      "content-type": type,
      "cache-control": CACHE_FOREVER,
      "x-content-type-options": "nosniff",
    },
  });
});

export const uploadRoutes = {
  "/api/uploads": { POST: upload },
  "/uploads/:file": { GET: serve },
};

// Kept for callers that want the directory (tests, cleanup scripts).
export { UPLOAD_DIR };
