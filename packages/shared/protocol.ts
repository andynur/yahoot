/**
 * The single source of truth for every WebSocket message.
 *
 * Rule (see .claude/skills/realtime-protocol): a message is defined HERE first,
 * as a Zod schema in the correct direction union, before any server or client
 * code touches it. Both apps import from `@shared/protocol` — nothing is
 * hand-written or untyped on either side.
 */
import { z } from "zod";
import {
  AVATARS,
  normalizePin,
  REACTIONS,
  THEME_PRESETS,
  type QuizTheme as QuizThemeShape,
} from "./wire";

// Re-exported so `@shared/protocol` stays the one import site on the server.
export {
  AVATARS,
  DEFAULT_AVATAR,
  DEFAULT_THEME,
  isYouTubeUrl,
  normalizePin,
  REACTIONS,
  THEME_PRESETS,
  readServerMessage,
  youTubeEmbedUrl,
  youTubeId,
} from "./wire";

// ---------------------------------------------------------------------------
// Shared value objects
// ---------------------------------------------------------------------------

export const GameState = z.enum([
  "LOBBY",
  "QUESTION_ACTIVE",
  "ANSWERS_LOCKED",
  "REVEAL",
  "LEADERBOARD",
  "ENDED",
]);
export type GameState = z.infer<typeof GameState>;

/** The two quiz formats a teacher can author. */
export const QuestionKind = z.enum(["multiple_choice", "true_false"]);
export type QuestionKind = z.infer<typeof QuestionKind>;

/**
 * Optional media shown with a question.
 *
 * `image` is a picture — a `/uploads/…` path we host (re-encoded on arrival, see
 * apps/server/http/images.ts) or an external image URL.
 * `video` is always a YouTube link. We never host video ourselves: the file
 * would be served to the whole class off the same box that is running the game.
 */
export const QuestionMedia = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("image"), url: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal("video"), url: z.string().min(1).max(2000) }),
]);
export type QuestionMedia = z.infer<typeof QuestionMedia>;

/** What a player is allowed to see about the current question. Never the answer. */
export const QuestionView = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  kind: QuestionKind,
  prompt: z.string(),
  media: QuestionMedia,
  choices: z.array(z.string()).min(2).max(6),
  /** absolute epoch-ms instant the server stops accepting answers */
  deadline: z.number().int().positive(),
  maxPoints: z.number().int().positive(),
});
export type QuestionView = z.infer<typeof QuestionView>;

export const LeaderboardRow = z.object({
  playerId: z.string(),
  nickname: z.string(),
  avatar: z.string(),
  score: z.number().int().nonnegative(),
  rank: z.number().int().positive(),
  /**
   * Rank before the question that just finished, so the scoreboard can show
   * ▲/▼ movement. Null on the first scoreboard, when there is nothing to
   * compare against.
   */
  previousRank: z.number().int().positive().nullable(),
});
export type LeaderboardRow = z.infer<typeof LeaderboardRow>;

/**
 * Backdrop for a quiz while it's on the projector. `preset` names a built-in
 * gradient; `image` optionally layers a picture over it (an uploaded
 * `/uploads/…` path or an external URL).
 */
export const ThemePreset = z.enum(THEME_PRESETS);
export type ThemePreset = z.infer<typeof ThemePreset>;

export const QuizTheme = z.object({
  preset: ThemePreset,
  image: z.string().max(2000).optional(),
}) satisfies z.ZodType<QuizThemeShape>;
export type QuizTheme = z.infer<typeof QuizTheme>;

export const Avatar = z.enum(AVATARS);
export type Avatar = z.infer<typeof Avatar>;

export const ReactionEmoji = z.enum(REACTIONS);
export type ReactionEmoji = z.infer<typeof ReactionEmoji>;

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export const PlayerJoin = z.object({
  type: z.literal("PLAYER_JOIN"),
  pin: z.string().transform(normalizePin),
  /**
   * Optional — a student can just tap Enter. The server then assigns a random
   * name, so the authority over what a player is called stays in one place.
   */
  nickname: z.string().trim().max(20).optional(),
  avatar: Avatar.optional(),
});

export const PlayerRejoin = z.object({
  type: z.literal("PLAYER_REJOIN"),
  pin: z.string().transform(normalizePin),
  playerId: z.string(),
});

export const PlayerAnswer = z.object({
  type: z.literal("PLAYER_ANSWER"),
  questionId: z.string(),
  choiceIndex: z.number().int().nonnegative(),
  // NOTE: no client timestamp. The server stamps arrival time itself — the
  // client clock is never trusted for scoring or lateness (anti-cheat).
});

export const HostStartQuestion = z.object({
  type: z.literal("HOST_START_QUESTION"),
  pin: z.string(),
});

export const HostNext = z.object({
  type: z.literal("HOST_NEXT"),
  pin: z.string(),
});

/** A player throws an emoji into the room. Cosmetic — never touches score. */
export const PlayerReact = z.object({
  type: z.literal("PLAYER_REACT"),
  emoji: ReactionEmoji,
});

export const ClientToServer = z.discriminatedUnion("type", [
  PlayerJoin,
  PlayerRejoin,
  PlayerAnswer,
  HostStartQuestion,
  HostNext,
  PlayerReact,
]);
export type ClientToServer = z.infer<typeof ClientToServer>;
export type ClientMessageType = ClientToServer["type"];

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

/** Full picture for a freshly connected or reconnecting client. Private (per-socket). */
export const StateSnapshot = z.object({
  type: z.literal("STATE_SNAPSHOT"),
  state: GameState,
  pin: z.string(),
  /** the hosting quiz's backdrop — host and player screens both theme from it */
  theme: QuizTheme,
  you: z
    .object({
      playerId: z.string(),
      nickname: z.string(),
      avatar: z.string(),
      score: z.number().int(),
    })
    .nullable(),
  question: QuestionView.nullable(),
  /** true if `you` has already answered the current question */
  answered: z.boolean(),
  leaderboard: z.array(LeaderboardRow),
  playerCount: z.number().int().nonnegative(),
});

/** Broadcast on the PIN topic so the host lobby updates. */
export const PlayerJoined = z.object({
  type: z.literal("PLAYER_JOINED"),
  playerId: z.string(),
  nickname: z.string(),
  avatar: z.string(),
  playerCount: z.number().int().nonnegative(),
});

export const QuestionShown = z.object({
  type: z.literal("QUESTION_SHOWN"),
  question: QuestionView,
});

/** Live count of answers in, so the host screen can show "12 answered". */
export const AnswerCount = z.object({
  type: z.literal("ANSWER_COUNT"),
  questionId: z.string(),
  count: z.number().int().nonnegative(),
});

/** An emoji thrown by a player, fanned out to the whole room. */
export const Reaction = z.object({
  type: z.literal("REACTION"),
  emoji: ReactionEmoji,
  from: z.string(),
});

export const AnswerAccepted = z.object({
  type: z.literal("ANSWER_ACCEPTED"),
  questionId: z.string(),
});

export const AnswerRejected = z.object({
  type: z.literal("ANSWER_REJECTED"),
  questionId: z.string(),
  reason: z.enum([
    "closed",
    "already_answered",
    "wrong_question",
    "not_a_player",
  ]),
});

/** Private per-player outcome for the question that just closed. */
export const AnswerResult = z.object({
  type: z.literal("ANSWER_RESULT"),
  questionId: z.string(),
  correct: z.boolean(),
  pointsAwarded: z.number().int().nonnegative(),
  totalScore: z.number().int().nonnegative(),
});

/** Public reveal on the PIN topic: the correct choice and how the room voted. */
export const QuestionClosed = z.object({
  type: z.literal("QUESTION_CLOSED"),
  questionId: z.string(),
  correctIndex: z.number().int().nonnegative(),
  /** answers per choice index */
  tally: z.array(z.number().int().nonnegative()),
});

export const Leaderboard = z.object({
  type: z.literal("LEADERBOARD"),
  leaderboard: z.array(LeaderboardRow),
  final: z.boolean(),
});

export const GameEnded = z.object({
  type: z.literal("GAME_ENDED"),
  leaderboard: z.array(LeaderboardRow),
});

export const ServerError = z.object({
  type: z.literal("ERROR"),
  message: z.string(),
});

export const ServerToClient = z.discriminatedUnion("type", [
  StateSnapshot,
  PlayerJoined,
  QuestionShown,
  AnswerCount,
  Reaction,
  AnswerAccepted,
  AnswerRejected,
  AnswerResult,
  QuestionClosed,
  Leaderboard,
  GameEnded,
  ServerError,
]);
export type ServerToClient = z.infer<typeof ServerToClient>;
export type ServerMessageType = ServerToClient["type"];

// Per-message inferred types (value + type share a name — different namespaces).
export type StateSnapshot = z.infer<typeof StateSnapshot>;
export type PlayerJoined = z.infer<typeof PlayerJoined>;
export type QuestionShown = z.infer<typeof QuestionShown>;
export type AnswerCount = z.infer<typeof AnswerCount>;
export type Reaction = z.infer<typeof Reaction>;
export type PlayerReact = z.infer<typeof PlayerReact>;
export type AnswerAccepted = z.infer<typeof AnswerAccepted>;
export type AnswerRejected = z.infer<typeof AnswerRejected>;
export type AnswerResult = z.infer<typeof AnswerResult>;
export type QuestionClosed = z.infer<typeof QuestionClosed>;
export type Leaderboard = z.infer<typeof Leaderboard>;
export type GameEnded = z.infer<typeof GameEnded>;

// ---------------------------------------------------------------------------
// Parse helpers — server and client both go through these.
// ---------------------------------------------------------------------------

export function parseClientMessage(raw: unknown): ClientToServer | null {
  const text = typeof raw === "string" ? safeJson(raw) : raw;
  const result = ClientToServer.safeParse(text);
  return result.success ? result.data : null;
}

export function parseServerMessage(raw: unknown): ServerToClient | null {
  const text = typeof raw === "string" ? safeJson(raw) : raw;
  const result = ServerToClient.safeParse(text);
  return result.success ? result.data : null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
