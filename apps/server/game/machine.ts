/**
 * The authoritative game state machine — pure, no I/O.
 *
 *   LOBBY ──HOST_START_QUESTION──▶ QUESTION_ACTIVE
 *   QUESTION_ACTIVE ──LOCK (timer expired | everyone answered)──▶ ANSWERS_LOCKED
 *   ANSWERS_LOCKED ──SCORED (server computed points)──▶ REVEAL
 *   REVEAL ──HOST_NEXT──▶ LEADERBOARD
 *   LEADERBOARD ──HOST_START_QUESTION──▶ QUESTION_ACTIVE (next question)
 *   LEADERBOARD ──HOST_NEXT──▶ ENDED
 *
 * Every transition is server-driven. The client never advances anything; it
 * only renders what STATE_SNAPSHOT / the event stream tells it.
 */
export type GameState =
  | "LOBBY"
  | "QUESTION_ACTIVE"
  | "ANSWERS_LOCKED"
  | "REVEAL"
  | "LEADERBOARD"
  | "ENDED";

export type GameEvent = "HOST_START_QUESTION" | "LOCK" | "SCORED" | "HOST_NEXT";

export interface MachineCtx {
  /** index of the question in play; -1 before the first question */
  questionIndex: number;
  totalQuestions: number;
}

export interface Transition {
  state: GameState;
  questionIndex: number;
}

/** Returns the next state, or `null` if the event is not legal from `state`. */
export function transition(
  state: GameState,
  event: GameEvent,
  ctx: MachineCtx,
): Transition | null {
  switch (state) {
    case "LOBBY":
      if (event === "HOST_START_QUESTION" && ctx.totalQuestions > 0) {
        return { state: "QUESTION_ACTIVE", questionIndex: 0 };
      }
      return null;

    case "QUESTION_ACTIVE":
      if (event === "LOCK") {
        return { state: "ANSWERS_LOCKED", questionIndex: ctx.questionIndex };
      }
      return null;

    case "ANSWERS_LOCKED":
      if (event === "SCORED") {
        return { state: "REVEAL", questionIndex: ctx.questionIndex };
      }
      return null;

    case "REVEAL":
      if (event === "HOST_NEXT") {
        return { state: "LEADERBOARD", questionIndex: ctx.questionIndex };
      }
      return null;

    case "LEADERBOARD":
      if (event === "HOST_START_QUESTION") {
        const next = ctx.questionIndex + 1;
        return next < ctx.totalQuestions
          ? { state: "QUESTION_ACTIVE", questionIndex: next }
          : null;
      }
      if (event === "HOST_NEXT") {
        return { state: "ENDED", questionIndex: ctx.questionIndex };
      }
      return null;

    case "ENDED":
      return null;
  }
}

export function isLastQuestion(ctx: MachineCtx): boolean {
  return ctx.questionIndex + 1 >= ctx.totalQuestions;
}
