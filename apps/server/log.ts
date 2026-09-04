/**
 * Structured JSON logging — one line per event, straight to stdout.
 *
 * In production this is the only window into a game that misbehaved, so game
 * events are logged unconditionally (never behind a debug flag). systemd/journald
 * or a file collector picks the lines up; each is valid JSON on its own line.
 *
 * Never log answer *content* before a question closes — the log would leak the
 * correct answer to anyone tailing it.
 */

export type GameEventName =
  | "join"
  | "rejoin"
  | "question_open"
  | "answer"
  | "question_close"
  | "game_end"
  | "disconnect";

interface BaseFields {
  pin: string;
  [key: string]: unknown;
}

function emit(level: "info" | "warn" | "error", event: string, fields: object) {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }) +
      "\n",
  );
}

/** A game-lifecycle event. `pin` is always present so a session can be grepped out. */
export function logGame(event: GameEventName, fields: BaseFields): void {
  emit("info", event, fields);
}

export function logInfo(event: string, fields: object = {}): void {
  emit("info", event, fields);
}

export function logWarn(event: string, fields: object = {}): void {
  emit("warn", event, fields);
}

export function logError(
  event: string,
  err: unknown,
  fields: object = {},
): void {
  emit("error", event, {
    ...fields,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
}
