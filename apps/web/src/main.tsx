import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SAME_ORIGIN } from "./config";

/**
 * Load the webfont in development.
 *
 * Production gets an @font-face injected into the built HTML (see
 * apps/web/build.ts): the bundler cannot be given a `url()` it can resolve,
 * because it would inline the woff2 as base64 and inflate the render-blocking
 * CSS tenfold. That left development with no @font-face at all, so the app
 * silently fell back to a system font and looked nothing like production.
 *
 * `SAME_ORIGIN` is baked to `true` by the production build, so the minifier
 * drops this whole block from the shipped bundle.
 */
if (!SAME_ORIGIN) {
  const face = new FontFace(
    "Montserrat",
    'url("/fonts/montserrat-var.woff2") format("woff2")',
    { style: "normal", weight: "400 900", display: "swap" },
  );
  face
    .load()
    .then((loaded) => document.fonts.add(loaded))
    .catch(() => {
      // Dev-only nicety: a missing font must never stop the app booting.
    });
}

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
