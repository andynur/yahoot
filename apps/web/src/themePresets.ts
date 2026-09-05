/**
 * The backdrop presets, as plain data.
 *
 * Kept apart from theme.ts because that module is a React hook that reaches for
 * `window` at import time. The share card needs only these colours, and it is
 * drawn on a canvas — pulling the hook in with it would drag the whole browser
 * environment into a unit test.
 *
 * Keep the gradients in sync with styles.css.
 */
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
