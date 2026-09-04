/**
 * Helpers for rendering question media.
 *
 * The YouTube parsing itself lives in `@shared/wire` so the server can validate
 * a pasted link with the exact function the client renders with — a URL the
 * editor accepts is a URL the API accepts. Only the `/uploads/…` resolution is
 * browser-specific, because only the browser knows which host serves the API.
 */
import type { QuestionMedia } from "@shared/protocol";
import { youTubeEmbedUrl, youTubeId } from "@shared/wire";
import { API_BASE } from "./config";

export type { QuestionMedia };
export { youTubeEmbedUrl, youTubeId };

/** A `/uploads/…` path is served by our API host; anything else is already absolute. */
export function resolveMediaUrl(url: string): string {
  return url.startsWith("/uploads/") ? `${API_BASE}${url}` : url;
}
