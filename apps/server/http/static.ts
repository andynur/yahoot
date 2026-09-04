/**
 * Serves the pre-built web app in production.
 *
 * The frontend is built on a developer machine (`bun run build:web`) and the
 * output is committed, so the deploy image ships only the backend plus whatever
 * bundle was built last. That keeps auto-deploys to backend-only changes fast
 * and means the container needs no Node/React toolchain at all.
 *
 * Serving the page from the same origin as /api and /ws is also what lets the
 * client drop its hard-coded port — see apps/web/src/config.ts.
 */
import { logWarn } from "../log";

const DIST =
  process.env.WEB_DIST ?? new URL("../../web/dist/", import.meta.url).pathname;

const INDEX = `${DIST}index.html`;

/**
 * Content-addressed or version-pinned assets can be cached forever: bundler
 * chunks carry a content hash, and a font is replaced by shipping a new
 * filename, never by editing the bytes behind an existing one.
 */
const isImmutableAsset = (path: string) =>
  /-[a-z0-9]{8,}\.(js|css)$/i.test(path) || path.startsWith("/fonts/");

const MIME: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  map: "application/json",
};

/**
 * Picks the best pre-compressed variant the client accepts.
 *
 * The bundle is compressed at build time (see apps/web/build.ts), so this is a
 * file lookup, not a compression pass — serving 80 phones costs no CPU.
 */
async function negotiate(
  path: string,
  acceptEncoding: string | null,
): Promise<{ file: Bun.BunFile; encoding: string | null } | null> {
  const accepts = (acceptEncoding ?? "").toLowerCase();
  if (accepts.includes("br")) {
    const br = Bun.file(`${path}.br`);
    if (await br.exists()) return { file: br, encoding: "br" };
  }
  if (accepts.includes("gzip")) {
    const gz = Bun.file(`${path}.gz`);
    if (await gz.exists()) return { file: gz, encoding: "gzip" };
  }
  const raw = Bun.file(path);
  return (await raw.exists()) ? { file: raw, encoding: null } : null;
}

let available: boolean | null = null;

/** Is there a built frontend to serve? Checked once, then cached. */
export async function hasWebBuild(): Promise<boolean> {
  if (available === null) available = await Bun.file(INDEX).exists();
  return available;
}

function contentType(path: string): string | undefined {
  return MIME[path.split(".").pop()?.toLowerCase() ?? ""];
}

/**
 * Returns the built asset, or index.html for an app route, or null when this
 * request isn't ours to answer.
 */
export async function serveWeb(req: Request): Promise<Response | null> {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  if (!(await hasWebBuild())) return null;

  const { pathname } = new URL(req.url);

  // Never let a crafted path climb out of the dist directory.
  const clean = decodeURIComponent(pathname).replace(/\\/g, "/");
  if (clean.includes("..") || clean.includes("\0")) return null;

  // A concrete file (has an extension) → serve it, or 404. Falling through to
  // index.html here would return HTML for a missing .js and confuse the browser.
  if (/\.[a-z0-9]+$/i.test(clean)) {
    // A .br/.gz path must never be requested directly — it is an encoding of
    // another asset, and serving it raw would hand the browser binary garbage.
    if (/\.(br|gz)$/i.test(clean)) return null;

    const picked = await negotiate(
      DIST + clean.replace(/^\/+/, ""),
      req.headers.get("accept-encoding"),
    );
    if (!picked) return null;

    const type = contentType(clean);
    return new Response(picked.file, {
      headers: {
        ...(type ? { "content-type": type } : {}),
        ...(picked.encoding ? { "content-encoding": picked.encoding } : {}),
        // Caches must key on the encoding, or a gzip response can be replayed
        // to a client that never asked for one.
        vary: "Accept-Encoding",
        "cache-control": isImmutableAsset(clean)
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600",
      },
    });
  }

  // Everything else is a client-side route.
  const index = await negotiate(INDEX, req.headers.get("accept-encoding"));
  if (!index) return null;
  return new Response(index.file, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(index.encoding ? { "content-encoding": index.encoding } : {}),
      vary: "Accept-Encoding",
      // index.html points at hashed assets — it must never be cached, or a
      // deploy would keep serving the old bundle's asset names.
      "cache-control": "no-cache",
    },
  });
}

/** Log once at boot so a missing build is obvious instead of a silent 404. */
export async function reportWebBuild(): Promise<void> {
  if (await hasWebBuild()) {
    console.log(`web     →  serving ${DIST}`);
  } else {
    logWarn("web_build_missing", {
      dist: DIST,
      hint: "run `bun run build:web` and commit apps/web/dist",
    });
  }
}
