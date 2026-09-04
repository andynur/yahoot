/**
 * The whole server: one Bun.serve for REST routes AND the WebSocket handler.
 * A module-level `server` reference is kept so the game engine can
 * `server.publish(pin, ...)` from anywhere (see ./bus).
 */
import { bindServer } from "./bus";
import { logWarn } from "./log";
import { env } from "./env";
import { migrate } from "./db/migrate";
import * as engine from "./game/engine";
import { makeRoutes } from "./http/rest";
import { preflight } from "./http/respond";
import { serveWeb, reportWebBuild } from "./http/static";
import { handleUpgrade, websocket } from "./http/ws";
import { sweepStale } from "./state/store";

const server = Bun.serve({
  port: env.SERVER_PORT,
  /**
   * Bun's default is 10 s of inactivity. That is fine for the API, but a teacher
   * uploading a photo over a school's upstream link can easily stall longer than
   * that mid-body; 30 s covers it without holding sockets open for long.
   */
  idleTimeout: 30,
  routes: makeRoutes(),
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") return handleUpgrade(req, server);
    if (req.method === "OPTIONS") return preflight(req);
    // Anything not claimed by an /api or /uploads route is the web app.
    const page = await serveWeb(req);
    if (page) return page;
    return new Response("not found", { status: 404 });
  },
  websocket,
  error(err) {
    console.error("server error:", err);
    return new Response("internal error", { status: 500 });
  },
});

bindServer(server);

// Abandoned games (host closed the tab, never finished) would otherwise sit in
// the live tables forever — SQLite has no key expiry to do it for us.
const swept = await sweepStale();
if (swept) console.log(`swept ${swept} abandoned game(s)`);

// A restart must not lose an in-flight game — rebuild the auto-close timers.
await engine.rehydrate().catch((err) => {
  console.warn("rehydrate skipped:", err instanceof Error ? err.message : err);
});

/**
 * The OS telling us it is running out of memory.
 *
 * A school self-hosting this has no dashboard and no alerting: when a quiz goes
 * sluggish, this log line is the only evidence of why. Deliberately just a
 * record — forcing a GC here would pause the process mid-question, which is
 * exactly the wrong thing to do to 80 phones waiting on an answer.
 */
process.on("memoryPressure", () => {
  logWarn("memory_pressure", {
    rssMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
    hint: "the machine is low on memory — check for other services on this box",
  });
});

await reportWebBuild();

console.log(`server  →  http://localhost:${server.port}`);
console.log(`ws      →  ws://localhost:${server.port}/ws`);
