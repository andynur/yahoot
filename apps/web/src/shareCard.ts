/**
 * Renders the final podium as a PNG the teacher can paste into a chat app.
 *
 * Drawn with the Canvas 2D API rather than screenshotting the DOM: a
 * DOM-to-image library is a dependency this project does not want, and the
 * podium on screen is sized for a projector, not for a 1200×675 chat preview.
 * Drawing it means the card is composed for where it actually gets pasted.
 */
import { DEFAULT_THEME, type QuizTheme } from "@shared/wire";
import { THEME_SWATCH } from "./themePresets";

/** Just enough of a result row to draw. Host rows and public rows both fit. */
export interface CardPlayer {
  nickname: string;
  avatar: string;
  score: number;
  rank: number;
}

export interface CardInput {
  quizTitle: string;
  theme: QuizTheme | null | undefined;
  players: CardPlayer[];
  questionCount: number;
  /** Public result URL, printed on the card so a screenshot still leads back. */
  url: string;
  endedAt?: string;
}

const WIDTH = 1200;
const HEIGHT = 675;
/** Drawn at 2× so text stays crisp when a chat app scales the image up. */
const SCALE = 2;

const SANS = '"Montserrat", system-ui, -apple-system, "Segoe UI", sans-serif';
const EMOJI =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const MEDAL = ["🥇", "🥈", "🥉"];
/** Visual order — tallest in the middle, as on the projector. */
const ORDER = [1, 0, 2];
const BLOCK_HEIGHT = [190, 145, 115];
const COLUMN_X = [600, 330, 870];
const COLUMN_W = 250;
const FLOOR = 570;

/**
 * The two gradient stops for a theme, read back out of the picker's swatches so
 * the card cannot drift from what the teacher chose in the editor.
 */
function themeColors(preset: string): [string, string] {
  const css = THEME_SWATCH[preset] ?? THEME_SWATCH.purple!;
  const stops = css.match(/#[0-9a-f]{6}/gi) ?? [];
  return [stops[0] ?? "#5a23b8", stops[1] ?? "#46178f"];
}

/** ctx.roundRect is recent; a teacher's laptop may predate it. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Shrink text until it fits, rather than letting a long nickname overflow. */
function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

/** Greedy word wrap, capped — a 200-character title must not eat the podium. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1]!, maxWidth);
  }
  return lines.length ? lines : [""];
}

function centred(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
}

export function formatScore(score: number): string {
  return score.toLocaleString();
}

function formatDate(iso: string | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Draw the card. Returns a PNG blob.
 *
 * Waits for `document.fonts.ready` first: without it the first render of a
 * session draws in the fallback font, because the webfont is still loading.
 */
export async function renderShareCard(input: CardInput): Promise<Blob> {
  if (document.fonts?.ready) await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser cannot render the result image");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";

  const preset = input.theme?.preset ?? DEFAULT_THEME.preset;
  const [from, to] = themeColors(preset);

  // Backdrop: the quiz's own theme gradient, corner to corner.
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, from);
  bg.addColorStop(1, to);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // A soft light from above, so the flat gradient reads as a stage.
  const glow = ctx.createRadialGradient(600, 120, 40, 600, 120, 700);
  glow.addColorStop(0, "rgba(255,255,255,0.16)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const players = [...input.players].sort((a, b) => a.rank - b.rank);
  const top = players.slice(0, 3);

  // --- header ---------------------------------------------------------------
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `700 22px ${SANS}`;
  ctx.letterSpacing = "3px";
  centred(ctx, "FINAL RESULTS", 600, 74);
  ctx.letterSpacing = "0px";

  // A two-line title has to shrink, or it runs into the winner's avatar: the
  // podium starts at a fixed height, so the header has a fixed budget too.
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 56px ${SANS}`;
  let titleLines = wrap(ctx, input.quizTitle, 1040, 2);
  if (titleLines.length > 1) {
    ctx.font = `800 44px ${SANS}`;
    titleLines = wrap(ctx, input.quizTitle, 1040, 2);
  }
  const firstBaseline = titleLines.length > 1 ? 118 : 140;
  const lineGap = titleLines.length > 1 ? 48 : 0;
  titleLines.forEach((line, i) =>
    centred(ctx, line, 600, firstBaseline + i * lineGap),
  );

  const meta = [
    `${players.length} ${players.length === 1 ? "player" : "players"}`,
    `${input.questionCount} ${input.questionCount === 1 ? "question" : "questions"}`,
    formatDate(input.endedAt),
  ]
    .filter(Boolean)
    .join("  ·  ");
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `600 24px ${SANS}`;
  centred(ctx, meta, 600, 196);

  // --- podium ---------------------------------------------------------------
  for (const slot of ORDER) {
    const player = top[slot];
    if (!player) continue;

    const cx = COLUMN_X[slot]!;
    const height = BLOCK_HEIGHT[slot]!;
    const blockTop = FLOOR - height;
    const left = cx - COLUMN_W / 2;

    // Avatar disc
    ctx.beginPath();
    ctx.arc(cx, blockTop - 128, 46, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fill();
    // Colour emoji still take the fill *alpha*, so a translucent fillStyle left
    // over from the disc would render the avatar as a ghost. Reset to opaque.
    ctx.fillStyle = "#ffffff";
    ctx.font = `52px ${EMOJI}`;
    ctx.textBaseline = "middle";
    centred(ctx, player.avatar, cx, blockTop - 126);
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = "#ffffff";
    ctx.font = `700 28px ${SANS}`;
    centred(
      ctx,
      ellipsize(ctx, player.nickname, COLUMN_W - 12),
      cx,
      blockTop - 56,
    );

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `800 34px ${SANS}`;
    centred(ctx, formatScore(player.score), cx, blockTop - 18);

    // The block itself
    ctx.fillStyle =
      slot === 0 ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.16)";
    roundRect(ctx, left, blockTop, COLUMN_W, height, 16);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = `44px ${EMOJI}`;
    ctx.textBaseline = "middle";
    centred(ctx, MEDAL[player.rank - 1] ?? "", cx, blockTop + height / 2);
    ctx.textBaseline = "alphabetic";
  }

  // --- footer ---------------------------------------------------------------
  const more = players.length - top.length;
  if (more > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `600 22px ${SANS}`;
    centred(ctx, `+ ${more} more on the full scoreboard`, 600, 612);
  }

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `700 22px ${SANS}`;
  centred(ctx, input.url.replace(/^https?:\/\//, ""), 600, 652);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("could not encode the image")),
      "image/png",
    );
  });
}

/**
 * The text that travels with the image.
 *
 * A single clipboard entry cannot make a chat app show "image then caption" —
 * the app picks one flavour. So the image and this text go on the clipboard
 * together: pasting into the message box yields the picture, pasting again into
 * the caption field yields this. Kept short enough to read as a caption.
 */
export function buildRecap(input: CardInput): string {
  const players = [...input.players].sort((a, b) => a.rank - b.rank);
  const podium = players
    .slice(0, 3)
    .map((p, i) => `${MEDAL[i]} ${p.nickname} — ${formatScore(p.score)}`)
    .join("\n");

  return [
    `🏆 ${input.quizTitle} — final results`,
    "",
    podium,
    "",
    `${players.length} ${players.length === 1 ? "player" : "players"} · ${input.questionCount} ${input.questionCount === 1 ? "question" : "questions"}`,
    `Full scoreboard: ${input.url}`,
  ].join("\n");
}
