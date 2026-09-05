/**
 * Bun's native fullstack dev server — bundles ./index.html and its script graph,
 * with HMR + React Fast Refresh. No Vite.
 */
import { Glob } from "bun";
import homepage from "./index.html";

const port = Number(process.env.WEB_PORT ?? 3001);

/**
 * Static files, served here the same way build.ts copies them into dist/.
 *
 * They cannot go through the bundler: it resolves `href`/`src` as module
 * specifiers and fails on an absolute path, and given a `url()` it can reach it
 * inlines the woff2 as base64. So in production they are copied verbatim and
 * referenced by absolute path — which meant that in development nothing served
 * them at all, and every icon, the font and the social card 404'd.
 */
const STATIC_DIRS: Array<{ prefix: string; dir: string }> = [
  { prefix: "/fonts/", dir: "./src/fonts/" },
  { prefix: "/", dir: "./src/static/" },
];

const MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
};

/** Built once at boot: URL path -> absolute file path. */
const staticFiles = new Map<string, string>();
for (const { prefix, dir } of STATIC_DIRS) {
  const root = new URL(dir, import.meta.url).pathname;
  for await (const name of new Glob("*").scan({ cwd: root })) {
    staticFiles.set(prefix + name, root + name);
  }
}

const server = Bun.serve({
  port,
  development: { hmr: true, console: true },
  // Client-side routing: every entry URL serves the same bundle.
  routes: {
    "/": homepage,
    "/host": homepage,
    "/play": homepage,
    "/join": homepage,
    "/results": homepage,
    // Public, shareable result page — /r/<share token>.
    "/r/:token": homepage,
  },
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const file = staticFiles.get(pathname);
    if (!file) return new Response("not found", { status: 404 });
    const type = MIME[pathname.split(".").pop()?.toLowerCase() ?? ""];
    return new Response(Bun.file(file), {
      headers: type ? { "content-type": type } : {},
    });
  },
});

console.log(`web     →  ${server.url}`);
console.log(
  `static  →  ${staticFiles.size} file(s) from src/static + src/fonts`,
);
