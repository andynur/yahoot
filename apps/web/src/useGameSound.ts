import { useEffect, useRef } from "react";
import type { GameState } from "@shared/protocol";
import { sfx, startLobbyLoop, stopLobbyLoop } from "./sound";
import type { useGameSocket } from "./useGameSocket";

type Game = ReturnType<typeof useGameSocket>;

/** Seconds of countdown that get an audible tick. */
const TICK_FROM = 5;

/**
 * Turns game-state transitions into audio cues.
 *
 * Everything keys off a *change* (previous value vs current), never off a render,
 * so a re-render can't retrigger a sound. `role` decides who hears what: the
 * projector plays the room-wide cues, the phone plays the player's own verdict.
 */
export function useGameSound(game: Game, role: "host" | "player"): void {
  const prevState = useRef<GameState | null>(null);
  const prevQuestionId = useRef<string | null>(null);
  const prevPlayerCount = useRef(0);
  const prevAnswered = useRef(false);
  const prevResultId = useRef<string | null>(null);
  const lastTickSecond = useRef<number>(Number.POSITIVE_INFINITY);

  // --- phase changes -------------------------------------------------------
  useEffect(() => {
    const state = game.state;
    if (state === prevState.current) return;
    const from = prevState.current;
    prevState.current = state;

    if (state === "LOBBY") {
      if (role === "host") startLobbyLoop();
      return;
    }
    stopLobbyLoop();

    switch (state) {
      case "REVEAL":
        // The player hears their own verdict instead (below); the host screen
        // gets the room-wide sting as the bars fill.
        if (role === "host") sfx.reveal();
        break;
      case "LEADERBOARD":
        sfx.leaderboard();
        break;
      case "ENDED":
        sfx.fanfare();
        break;
      default:
        break;
    }

    // leaving a question without a reveal (host skipped ahead)
    if (from === "QUESTION_ACTIVE" && state === "ANSWERS_LOCKED") {
      lastTickSecond.current = Number.POSITIVE_INFINITY;
    }
  }, [game.state, role]);

  // --- a new question opens ------------------------------------------------
  useEffect(() => {
    const id = game.question?.id ?? null;
    if (id === prevQuestionId.current) return;
    prevQuestionId.current = id;
    lastTickSecond.current = Number.POSITIVE_INFINITY;
    if (id && game.state === "QUESTION_ACTIVE") sfx.questionStart();
  }, [game.question?.id, game.state]);

  // --- countdown ticks -----------------------------------------------------
  useEffect(() => {
    const deadline = game.question?.deadline;
    if (game.state !== "QUESTION_ACTIVE" || !deadline) return;
    // A player who already answered shouldn't be pressured by ticking.
    if (role === "player" && game.answered) return;

    const id = setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left > TICK_FROM || left <= 0) return;
      if (left >= lastTickSecond.current) return; // already ticked this second
      lastTickSecond.current = left;
      sfx.tick((TICK_FROM - left) / TICK_FROM);
    }, 100);
    return () => clearInterval(id);
  }, [game.state, game.question?.deadline, game.answered, role]);

  // --- host: a player joins ------------------------------------------------
  useEffect(() => {
    if (role !== "host") return;
    if (game.playerCount > prevPlayerCount.current) sfx.join();
    prevPlayerCount.current = game.playerCount;
  }, [game.playerCount, role]);

  // --- player: answer locked in -------------------------------------------
  useEffect(() => {
    if (role !== "player") return;
    if (game.answered && !prevAnswered.current) sfx.locked();
    prevAnswered.current = game.answered;
  }, [game.answered, role]);

  // --- player: their own verdict ------------------------------------------
  useEffect(() => {
    if (role !== "player") return;
    const result = game.myResult;
    if (!result || result.questionId === prevResultId.current) return;
    prevResultId.current = result.questionId;
    if (result.correct) sfx.correct();
    else sfx.wrong();
  }, [game.myResult, role]);

  // stop the lobby bed if the view unmounts mid-game
  useEffect(() => stopLobbyLoop, []);
}
