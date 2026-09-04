/**
 * The zod-free half of the shared protocol.
 *
 * Constants and plain helpers live here so the browser can use them without
 * pulling Zod into its bundle — Zod is ~364 KB minified, more than React, and
 * it exists on the client only to re-check messages our own server produced.
 *
 * `protocol.ts` builds its Zod schemas *from* these constants, so there is still
 * exactly one definition of each value (architecture rule 4 holds).
 *
 * Trust boundary, stated plainly:
 *   client → server  untrusted  → the server validates with Zod. Never remove.
 *   server → client  our own    → the client narrows on the `type` field.
 */
import type { ServerToClient } from "./protocol";

/**
 * PINs are displayed grouped ("142 001"), and students type or paste them that
 * way. Strip everything that isn't a digit so the room is still found.
 */
export function normalizePin(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Animal avatars a player can pick on the join screen. */
export const AVATARS = [
  "🦊",
  "🐼",
  "🐯",
  "🦁",
  "🐸",
  "🐵",
  "🐨",
  "🦉",
  "🐢",
  "🦄",
] as const;
export type Avatar = (typeof AVATARS)[number];
export const DEFAULT_AVATAR: Avatar = "🦊";

/** The emoji players can throw into the room. */
export const REACTIONS = ["😂", "😮", "😎", "🔥", "❤️", "👏"] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];

/** Built-in quiz backdrops. */
export const THEME_PRESETS = [
  "purple",
  "midnight",
  "sunset",
  "forest",
  "ocean",
  "candy",
] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

export interface QuizTheme {
  preset: ThemePreset;
  image?: string;
}
export const DEFAULT_THEME: QuizTheme = { preset: "purple" };

/**
 * Parse a frame the server sent us.
 *
 * Deliberately not a Zod parse: this is our own server's output, and the
 * reducer's `switch (m.type)` gives TypeScript the same narrowing a schema
 * would. Unknown `type` values fall through that switch untouched, so an older
 * client stays forward-compatible with a newer server.
 */
export function readServerMessage(raw: unknown): ServerToClient | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  if (typeof (value as { type?: unknown }).type !== "string") return null;
  return value as ServerToClient;
}

// ---------------------------------------------------------------------------
// Question video — YouTube only
// ---------------------------------------------------------------------------
//
// A question's video is always an embedded YouTube clip. Self-hosted video was
// removed deliberately: a 30 MB clip served to a class of 80 is 2.4 GB off a
// cheap VPS's bandwidth for one question, and it competes with the WebSocket
// traffic the game actually depends on. YouTube's CDN carries it for free.
//
// This lives in wire.ts, not in the web app, because the server validates the
// URL on save with the very same parser the client renders with.

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

/** Pull the 11-char video id out of any common YouTube URL shape, or null. */
export function youTubeId(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(u.hostname)) return null;

  const id = u.hostname.endsWith("youtu.be")
    ? u.pathname.slice(1)
    : u.pathname === "/watch"
      ? u.searchParams.get("v")
      : /^\/(embed|shorts|live)\//.test(u.pathname)
        ? u.pathname.split("/")[2]
        : null;

  return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
}

/** True when a URL is a YouTube link we can embed. */
export function isYouTubeUrl(raw: string): boolean {
  return youTubeId(raw) !== null;
}

export function youTubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;
}
