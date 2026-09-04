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

/** Swatch gradients for the picker — must stay in sync with styles.css. */
export const THEME_SWATCH: Record<string, string> = {
  purple: "linear-gradient(135deg, #5a23b8, #46178f)",
  midnight: "linear-gradient(135deg, #1b2a4a, #0b1220)",
  sunset: "linear-gradient(135deg, #ff7e5f, #b4418e)",
  forest: "linear-gradient(135deg, #2e7d4f, #14432a)",
  ocean: "linear-gradient(135deg, #1479b8, #0a3d62)",
  candy: "linear-gradient(135deg, #ff6ec7, #7d2ee6)",
};

export const THEME_LABEL: Record<string, string> = {
  purple: "Purple",
  midnight: "Midnight",
  sunset: "Sunset",
  forest: "Forest",
  ocean: "Ocean",
  candy: "Candy",
};
