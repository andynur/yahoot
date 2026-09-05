import { useEffect } from "react";
import { DEFAULT_THEME, type QuizTheme } from "@shared/wire";
import { resolveMediaUrl } from "./media";

/**
 * Paints the quiz backdrop.
 *
 * Applied to `document.body` rather than a container so it's genuinely
 * full-bleed on the projector — a themed div would still leave the page
 * background showing around it.
 */
/**
 * True once a URL is complete enough to be worth loading. Without this, typing
 * an address into the editor would fire a request per keystroke ("h", "ht", …),
 * each resolving against the page and 404ing.
 */
function isLoadableImageUrl(url: string): boolean {
  const u = url.trim();
  if (u.startsWith("/uploads/")) return true;
  return /^https?:\/\/.+\..+/i.test(u);
}

export function useQuizTheme(theme: QuizTheme | null | undefined): void {
  const preset = theme?.preset ?? DEFAULT_THEME.preset;
  const raw = theme?.image;
  const image = raw && isLoadableImageUrl(raw) ? raw : undefined;

  useEffect(() => {
    const body = document.body;
    body.dataset.theme = preset;
    if (image) {
      body.style.setProperty(
        "--bg-image",
        `url("${resolveMediaUrl(image).replace(/"/g, '\\"')}")`,
      );
      body.classList.add("has-bg-image");
    } else {
      body.style.removeProperty("--bg-image");
      body.classList.remove("has-bg-image");
    }

    return () => {
      delete body.dataset.theme;
      body.style.removeProperty("--bg-image");
      body.classList.remove("has-bg-image");
    };
  }, [preset, image]);
}

/** Re-exported so existing imports of the picker's swatches keep working. */
export { THEME_LABEL, THEME_SWATCH } from "./themePresets";
