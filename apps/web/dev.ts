/**
 * Bun's native fullstack dev server — bundles ./index.html and its script graph,
 * with HMR + React Fast Refresh. No Vite.
 */
import homepage from "./index.html";

const port = Number(process.env.WEB_PORT ?? 3001);

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
  },
});

console.log(`web     →  ${server.url}`);
