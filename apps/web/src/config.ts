/**
 * Where the browser reaches the API / WebSocket server.
 *
 * Production: the Bun server serves the page, `/api`, `/uploads` and `/ws` from
 * one origin, so everything is same-origin and the port must NOT be guessed —
 * behind HTTPS the page is on :443 and any hard-coded port breaks it. The
 * production build bakes in `YAHOOT_SAME_ORIGIN` (see apps/web/build.ts).
 *
 * Dev: the web dev server and the API run on different ports, so fall back to
 * the API port on the same host. That also makes a classroom LAN work with no
 * config — students open http://<teacher-ip>:<web-port> and the app calls
 * http://<teacher-ip>:3020.
 *
 * `window.YAHOOT_SERVER_URL` overrides both, for one-off setups.
 */
declare global {
  interface Window {
    YAHOOT_SERVER_URL?: string;
  }
}

/** Replaced with `true` by the production build; undefined in dev. */
declare const YAHOOT_SAME_ORIGIN: boolean | undefined;

const DEV_SERVER_PORT = 3020;

/** True in a production build; false under `bun dev`. */
export const SAME_ORIGIN =
  typeof YAHOOT_SAME_ORIGIN !== "undefined" && YAHOOT_SAME_ORIGIN === true;

const sameOrigin = SAME_ORIGIN;

export const API_BASE =
  window.YAHOOT_SERVER_URL ??
  (sameOrigin
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname || "localhost"}:${DEV_SERVER_PORT}`);

/** http → ws, https → wss. Never hard-code the scheme. */
export const WS_BASE = API_BASE.replace(/^http/, "ws");
