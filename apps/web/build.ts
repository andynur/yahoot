/**
 * Production build for the web app.
 *
 *   bun run build:web
 *
 * Output goes to apps/web/dist/ and is COMMITTED on purpose: the deploy image
 * ships only the backend, so whatever was built last is what gets served.
 *
 * Two things happen here that matter in production:
 *  - `YAHOOT_SAME_ORIGIN` is baked in, so the client never guesses a port.
 *  - Assets are pre-compressed, so serving costs the server no CPU at all.
 */
import { Glob } from "bun";
import { rm } from "node:fs/promises";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const outdir = new URL("./dist/", import.meta.url).pathname;

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [new URL("./index.html", import.meta.url).pathname],
  outdir,
  // Absolute asset URLs: the SPA serves the same index.html for /host, /play …
  // and a relative "./chunk.js" would resolve differently per route.
  publicPath: "/",
  minify: true,
  sourcemap: "none",
  define: {
    YAHOOT_SAME_ORIGIN: "true",
    "process.env.NODE_ENV": '"production"',
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

/**
 * Zod must never reach the browser: it is larger than React and on the client
 * it only re-checked messages our own server produced. Runtime values come from
 * @shared/wire, types from @shared/protocol via `import type`. A stray value
 * import would silently drag the whole library back in — fail loudly instead.
 */
async function assertNoZod(files: string[]): Promise<void> {
  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    const text = await Bun.file(file).text();
    for (const marker of ["ZodError", "$ZodString", "safeParse"]) {
      if (text.includes(marker)) {
        console.error(
          `\n✗ ${file.replace(outdir, "")} contains "${marker}" — Zod leaked into the client bundle.\n` +
            "  Import runtime values from @shared/wire, and types with `import type` from @shared/protocol.",
        );
        process.exit(1);
      }
    }
  }
}

/**
 * Pre-compress at build time rather than per request: the server just picks a
 * variant, so serving costs no CPU and brotli can run at maximum quality.
 */
async function precompress(file: string): Promise<{ gz: number; br: number }> {
  const bytes = await Bun.file(file).bytes();
  const gz = gzipSync(bytes, { level: 9 });
  const br = brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
    },
  });
  await Bun.write(`${file}.gz`, gz);
  await Bun.write(`${file}.br`, br);
  return { gz: gz.length, br: br.length };
}

/**
 * Static assets copied verbatim, referenced by absolute URL from the CSS.
 *
 * Deliberately not routed through the bundler: it inlines a small woff2 as
 * base64, which inflates it ~33 %, defeats brotli (woff2 is already compressed)
 * and buries it inside render-blocking CSS.
 */
/**
 * The @font-face is injected into the built HTML rather than written in the
 * source, because Bun's bundler resolves every `url()` it sees — in CSS *and*
 * in HTML <style> — and inlines the woff2 as base64. That inflates it ~33 %,
 * defeats brotli (woff2 is already compressed) and moves 37 KB into the
 * render-blocking stylesheet, delaying first paint.
 *
 * Preloaded so the swap happens immediately. The filename is the version: to
 * change the font, ship a new name.
 */
async function injectFont(): Promise<void> {
  const htmlPath = `${outdir}index.html`;
  const html = await Bun.file(htmlPath).text();
  const head = `    <link rel="preload" as="font" type="font/woff2" href="/fonts/montserrat-var.woff2" crossorigin>
    <style>@font-face{font-family:"Montserrat";font-style:normal;font-weight:400 900;font-display:swap;src:url("/fonts/montserrat-var.woff2") format("woff2")}</style>
  </head>`;
  if (!html.includes("</head>")) {
    console.error("✗ built index.html has no </head> to inject the font into");
    process.exit(1);
  }
  await Bun.write(htmlPath, html.replace("</head>", head));
}

async function copyStatic(): Promise<number> {
  const src = new URL("./src/fonts/", import.meta.url).pathname;
  let bytes = 0;
  for await (const rel of new Glob("*").scan({ cwd: src })) {
    const file = Bun.file(src + rel);
    await Bun.write(`${outdir}fonts/${rel}`, file);
    bytes += file.size;
    console.log(`  fonts/${rel}  ${(file.size / 1024).toFixed(1)} KB`);
  }
  return bytes;
}

const COMPRESSIBLE = /\.(js|css|html|svg|json|txt)$/i;
/** Below this, framing overhead makes compression pointless. */
const MIN_COMPRESS_BYTES = 1024;

await assertNoZod(result.outputs.map((o) => o.path));

let raw = 0;
let wire = 0;
await injectFont();
const staticBytes = await copyStatic();
raw += staticBytes;
wire += staticBytes; // woff2 is already compressed
for (const output of result.outputs) {
  const size = output.size ?? 0;
  raw += size;
  let note = "";
  if (COMPRESSIBLE.test(output.path) && size >= MIN_COMPRESS_BYTES) {
    const { gz, br } = await precompress(output.path);
    wire += br;
    note = `  → gzip ${(gz / 1024).toFixed(1)} KB · brotli ${(br / 1024).toFixed(1)} KB`;
  } else {
    wire += size;
  }
  console.log(
    `  ${output.path.replace(outdir, "")}  ${(size / 1024).toFixed(1)} KB${note}`,
  );
}

console.log(
  `\nbuilt ${result.outputs.length} files → apps/web/dist\n` +
    `  raw           ${(raw / 1024).toFixed(1)} KB\n` +
    `  over the wire ${(wire / 1024).toFixed(1)} KB (brotli)`,
);
