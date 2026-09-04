import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  AnswerResult,
  ClientToServer,
  GameState,
  LeaderboardRow,
  QuestionClosed,
  QuestionView,
  QuizTheme,
  ReactionEmoji,
  StateSnapshot,
} from "@shared/protocol";
import { readServerMessage, type Avatar } from "@shared/wire";
import type { FloatingReaction } from "./components/Reactions";
import { WS_BASE } from "./config";

export type Role = "host" | "player";

interface JoinedPlayer {
  playerId: string;
  nickname: string;
  avatar: string;
}

interface GameSnapshot {
  connected: boolean;
  state: GameState | null;
  theme: QuizTheme | null;
  you: StateSnapshot["you"];
  answered: boolean;
  question: QuestionView | null;
  questionShownAt: number | null;
  answerCount: number;
  leaderboard: LeaderboardRow[];
  playerCount: number;
  players: JoinedPlayer[];
  reveal: QuestionClosed | null;
  myResult: AnswerResult | null;
  reactions: FloatingReaction[];
  ended: boolean;
  /** transient message: rejected answer, server error, etc. */
  notice: string | null;
}

const INITIAL: GameSnapshot = {
  connected: false,
  state: null,
  theme: null,
  you: null,
  answered: false,
  question: null,
  questionShownAt: null,
  answerCount: 0,
  leaderboard: [],
  playerCount: 0,
  players: [],
  reveal: null,
  myResult: null,
  reactions: [],
  ended: false,
  notice: null,
};

type Action =
  | { t: "open" }
  | { t: "close" }
  | { t: "reaction"; r: FloatingReaction }
  | { t: "server"; m: NonNullable<ReturnType<typeof readServerMessage>> };

function rejectionText(reason: string): string {
  switch (reason) {
    case "closed":
      return "Too late — the question is closed";
    case "already_answered":
      return "You already answered this one";
    case "wrong_question":
      return "That question isn't active anymore";
    default:
      return "Answer not accepted";
  }
}

const MAX_FLOATING = 28;

function reducer(s: GameSnapshot, a: Action): GameSnapshot {
  if (a.t === "open") return { ...s, connected: true };
  if (a.t === "close") return { ...s, connected: false };
  if (a.t === "reaction") {
    return { ...s, reactions: [...s.reactions, a.r].slice(-MAX_FLOATING) };
  }

  const m = a.m;
  switch (m.type) {
    case "STATE_SNAPSHOT":
      return {
        ...s,
        state: m.state,
        theme: m.theme,
        you: m.you,
        answered: m.answered,
        question: m.question,
        questionShownAt:
          m.state === "QUESTION_ACTIVE" && m.question
            ? (s.questionShownAt ?? Date.now())
            : null,
        leaderboard: m.leaderboard,
        playerCount: m.playerCount,
        reveal: m.state === "REVEAL" ? s.reveal : null,
        myResult:
          m.state === "LOBBY" || m.state === "QUESTION_ACTIVE"
            ? null
            : s.myResult,
        ended: m.state === "ENDED",
      };
    case "PLAYER_JOINED":
      return {
        ...s,
        playerCount: m.playerCount,
        players: s.players.some((p) => p.playerId === m.playerId)
          ? s.players
          : [
              ...s.players,
              {
                playerId: m.playerId,
                nickname: m.nickname,
                avatar: m.avatar,
              },
            ],
      };
    case "QUESTION_SHOWN":
      return {
        ...s,
        state: "QUESTION_ACTIVE",
        question: m.question,
        questionShownAt: Date.now(),
        answerCount: 0,
        answered: false,
        reveal: null,
        myResult: null,
        notice: null,
      };
    case "ANSWER_COUNT":
      return m.questionId === s.question?.id
        ? { ...s, answerCount: m.count }
        : s;
    case "ANSWER_ACCEPTED":
      return { ...s, answered: true, notice: "Answer locked in" };
    case "ANSWER_REJECTED":
      return { ...s, notice: rejectionText(m.reason) };
    case "ANSWER_RESULT":
      return {
        ...s,
        myResult: m,
        you: s.you ? { ...s.you, score: m.totalScore } : s.you,
      };
    case "QUESTION_CLOSED":
      return { ...s, state: "REVEAL", reveal: m };
    case "LEADERBOARD":
      return {
        ...s,
        state: "LEADERBOARD",
        leaderboard: m.leaderboard,
        ended: m.final,
      };
    case "GAME_ENDED":
      return { ...s, state: "ENDED", leaderboard: m.leaderboard, ended: true };
    case "REACTION":
      return s; // handled as an "reaction" action from onmessage
    case "ERROR":
      return { ...s, notice: m.message };
    default:
      return s;
  }
}

const storageKey = (pin: string) => `yahoot:player:${pin}`;
let reactionSeq = 0;

export function useGameSocket(opts: {
  pin: string | null;
  role: Role;
  token?: string | null;
}) {
  const { pin, role, token } = opts;
  const [snap, dispatch] = useReducer(reducer, INITIAL);
  const wsRef = useRef<WebSocket | null>(null);

  const send = useCallback((msg: ClientToServer) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (!pin) return;
    let stopped = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (stopped) return;
      const params = new URLSearchParams({ pin, role });
      if (role === "host" && token) params.set("token", token);
      const ws = new WebSocket(`${WS_BASE}/ws?${params.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retries = 0;
        dispatch({ t: "open" });
        if (role === "player") {
          const playerId = sessionStorage.getItem(storageKey(pin));
          if (playerId) send({ type: "PLAYER_REJOIN", pin, playerId });
        }
      };

      ws.onmessage = (ev) => {
        const m = readServerMessage(typeof ev.data === "string" ? ev.data : "");
        if (!m) return;
        if (m.type === "STATE_SNAPSHOT" && m.you) {
          sessionStorage.setItem(storageKey(pin), m.you.playerId);
        }
        if (m.type === "REACTION") {
          dispatch({
            t: "reaction",
            r: {
              id: ++reactionSeq,
              emoji: m.emoji,
              from: m.from,
              left: 4 + Math.random() * 88,
              duration: 2.6 + Math.random() * 1.6,
              drift: (Math.random() - 0.5) * 120,
            },
          });
          return;
        }
        dispatch({ t: "server", m });
      };

      ws.onerror = () => ws.close();
      ws.onclose = () => {
        dispatch({ t: "close" });
        if (stopped) return;
        timer = setTimeout(connect, Math.min(1000 * 2 ** retries++, 8000));
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [pin, role, token, send]);

  const joinAsPlayer = useCallback(
    (nickname: string, avatar?: Avatar) => {
      // An empty nickname is intentional — the server names the player.
      if (pin)
        send({
          type: "PLAYER_JOIN",
          pin,
          nickname: nickname.trim() || undefined,
          avatar,
        });
    },
    [pin, send],
  );

  const react = useCallback(
    (emoji: ReactionEmoji) => send({ type: "PLAYER_REACT", emoji }),
    [send],
  );

  const forgetPlayer = useCallback(() => {
    if (pin) sessionStorage.removeItem(storageKey(pin));
  }, [pin]);

  return { ...snap, send, joinAsPlayer, react, forgetPlayer };
}

/** Cosmetic only — the server's `deadline` is the real clock. */
export function useCountdown(deadline: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
