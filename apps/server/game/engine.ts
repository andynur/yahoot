/**
 * The game engine: orchestrates the pure state machine (./machine) over the
 * live-state store (../state/store) and the WebSocket bus (../bus).
 *
 * Non-negotiables enforced here:
 *  - The server owns time. `askedAt` / `deadline` are set from the server clock;
 *    a server-side timeout closes the question. Client timestamps are ignored.
 *  - Scoring runs ONLY here, via the shared pure `computeScore`.
 *  - Answers after `deadline` (or after the state leaves QUESTION_ACTIVE) are
 *    rejected — that's the anti-cheat line, don't "simplify" it away.
 *  - Live state is in the `live_*` tables. Final results are written to the
 *    durable tables once, in `endGame`.
 *
 * Concurrency: one server process is assumed (fine for a classroom). Transition
 * functions re-load the snapshot and check the precondition state, which settles
 * the timer vs. host-action race. That check is NOT sufficient on its own for
 * closing a question — read-check-save spans await points, and a whole class
 * answering in the same burst slips through the gap — so lockAndScore takes an
 * atomic claim first. See store.claimScoring.
 */
import { computeScore } from "@shared/scoring";
import { AVATARS, DEFAULT_AVATAR, DEFAULT_THEME } from "@shared/protocol";
import type {
  LeaderboardRow,
  QuestionView,
  QuizTheme,
  ReactionEmoji,
  ServerToClient,
  StateSnapshot as StateSnapshotMsg,
} from "@shared/protocol";
import type { ServerWebSocket } from "bun";
import { publish, send, hostTopic, playerTopic } from "../bus";
import { nowIso, run, tx } from "../db/db";
import { logError, logGame } from "../log";
import type { SocketData } from "../socket";
import * as store from "../state/store";
import { transition, isLastQuestion, type GameEvent } from "./machine";
import { randomAvatar, randomNickname } from "./nicknames";
import type { CurrentQuestion, EngineQuestion, Snapshot } from "./types";

const LEADERBOARD_SIZE = 10;

/** Server-side auto-close timers, keyed by PIN. Rebuilt from the store on restart. */
const lockTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Cosmetic emoji-spam throttle, keyed by playerId. Not game state. */
const lastReactAt = new Map<string, number>();
const REACT_COOLDOWN_MS = 600;

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

export async function createSession(input: {
  sessionId: string;
  pin: string;
  quizId: string;
  quizTitle: string;
  theme: QuizTheme;
  questions: EngineQuestion[];
}): Promise<void> {
  const snapshot: Snapshot = {
    pin: input.pin,
    sessionId: input.sessionId,
    quizId: input.quizId,
    quizTitle: input.quizTitle,
    theme: input.theme,
    state: "LOBBY",
    questionIndex: -1,
    totalQuestions: input.questions.length,
    questions: input.questions,
    current: null,
  };
  await store.saveSnapshot(snapshot);
  await store.registerActive(input.pin);
}

// ---------------------------------------------------------------------------
// Snapshots for (re)connecting clients
// ---------------------------------------------------------------------------

function questionView(
  snap: Snapshot,
  current: CurrentQuestion,
): QuestionView | null {
  const q = snap.questions[current.index];
  if (!q) return null;
  return {
    id: q.id,
    index: current.index,
    total: snap.totalQuestions,
    kind: q.kind,
    prompt: q.prompt,
    media: q.media,
    choices: q.choices,
    deadline: current.deadline,
    maxPoints: q.maxPoints,
  };
}

export async function buildSnapshotMessage(
  pin: string,
  playerId: string | null,
): Promise<StateSnapshotMsg | null> {
  const snap = await store.loadSnapshot(pin);
  if (!snap) return null;

  const leaderboard = await buildLeaderboard(pin, LEADERBOARD_SIZE);
  const question =
    snap.state === "QUESTION_ACTIVE" && snap.current
      ? questionView(snap, snap.current)
      : null;

  let you: StateSnapshotMsg["you"] = null;
  let answered = false;
  if (playerId) {
    const player = await store.getPlayer(pin, playerId);
    if (player) {
      you = {
        playerId,
        nickname: player.nickname,
        avatar: player.avatar ?? DEFAULT_AVATAR,
        score: await store.getScore(pin, playerId),
      };
      if (snap.current)
        answered = await store.hasAnswered(pin, snap.current.index, playerId);
    }
  }

  return {
    type: "STATE_SNAPSHOT",
    state: snap.state,
    pin,
    // a session created before themes existed has no theme key
    theme: snap.theme ?? DEFAULT_THEME,
    you,
    question,
    answered,
    leaderboard,
    playerCount: await store.playerCount(pin),
  };
}

export async function sendSnapshot(
  ws: ServerWebSocket<SocketData>,
  pin: string,
  playerId: string | null,
): Promise<void> {
  const msg = await buildSnapshotMessage(pin, playerId);
  if (msg) send(ws, msg);
  else send(ws, { type: "ERROR", message: "game not found" });
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export async function playerJoin(
  pin: string,
  requestedNickname: string | undefined,
  requestedAvatar: string | undefined,
): Promise<{ playerId: string } | { error: string }> {
  const snap = await store.loadSnapshot(pin);
  if (!snap) return { error: "game not found" };
  if (snap.state !== "LOBBY") return { error: "game already started" };

  // Empty name is allowed — the server names the player instead, checking the
  // room so two silent joiners never end up identical.
  const trimmed = requestedNickname?.trim();
  const nickname = trimmed
    ? trimmed
    : randomNickname(
        Object.values(await store.getPlayers(pin)).map((p) => p.nickname),
      );
  const avatar = requestedAvatar ?? randomAvatar(AVATARS);

  const playerId = crypto.randomUUID();
  await store.addPlayer(pin, playerId, {
    nickname,
    avatar,
    joinedAt: Date.now(),
  });

  const playerCount = await store.playerCount(pin);
  logGame("join", { pin, playerId, nickname, avatar, playerCount });

  publish(pin, {
    type: "PLAYER_JOINED",
    playerId,
    nickname,
    avatar,
    playerCount,
  });
  return { playerId };
}

export async function playerRejoin(
  pin: string,
  playerId: string,
): Promise<boolean> {
  const player = await store.getPlayer(pin, playerId);
  logGame("rejoin", { pin, playerId, ok: player !== null });
  return player !== null;
}

/** Fan a player's emoji out to the whole room. Purely cosmetic. */
export async function playerReact(
  pin: string,
  playerId: string,
  emoji: ReactionEmoji,
): Promise<void> {
  const now = Date.now();
  if (now - (lastReactAt.get(playerId) ?? 0) < REACT_COOLDOWN_MS) return;
  const player = await store.getPlayer(pin, playerId);
  if (!player) return;
  lastReactAt.set(playerId, now);
  publish(pin, { type: "REACTION", emoji, from: player.nickname });
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

export async function handleAnswer(
  ws: ServerWebSocket<SocketData>,
  pin: string,
  playerId: string,
  questionId: string,
  choiceIndex: number,
  receivedAt: number,
): Promise<void> {
  const snap = await store.loadSnapshot(pin);
  const current = snap?.current;

  const reject = (
    reason: "closed" | "already_answered" | "wrong_question" | "not_a_player",
  ) => {
    logGame("answer", { pin, playerId, questionId, accepted: false, reason });
    return send(ws, { type: "ANSWER_REJECTED", questionId, reason });
  };

  if (!snap || !current) return reject("closed");
  if ((await store.getPlayer(pin, playerId)) === null)
    return reject("not_a_player");
  if (current.questionId !== questionId) return reject("wrong_question");
  // The server clock is the only authority on lateness.
  if (snap.state !== "QUESTION_ACTIVE" || receivedAt >= current.deadline)
    return reject("closed");

  const wrote = await store.recordAnswer(pin, current.index, playerId, {
    choiceIndex,
    answeredAt: receivedAt,
  });
  if (!wrote) return reject("already_answered");

  send(ws, { type: "ANSWER_ACCEPTED", questionId });

  const [answers, players] = await Promise.all([
    store.getAnswers(pin, current.index),
    store.playerCount(pin),
  ]);
  const answered = Object.keys(answers).length;

  // No choiceIndex here — logging it before the reveal would leak answers.
  logGame("answer", {
    pin,
    playerId,
    questionId,
    accepted: true,
    msBeforeDeadline: current.deadline - receivedAt,
    answered,
  });

  // Host screen only — see bus.ts on why this must not hit the public topic.
  publish(hostTopic(pin), {
    type: "ANSWER_COUNT",
    questionId,
    count: answered,
  });

  // Early close once every current player has answered.
  if (answered >= players && players > 0) {
    await lockAndScore(pin);
  }
}

// ---------------------------------------------------------------------------
// Host-driven transitions
// ---------------------------------------------------------------------------

async function advance(
  pin: string,
  event: GameEvent,
): Promise<{ snap: Snapshot; nextIndex: number } | null> {
  const snap = await store.loadSnapshot(pin);
  if (!snap) return null;
  const next = transition(snap.state, event, {
    questionIndex: snap.questionIndex,
    totalQuestions: snap.totalQuestions,
  });
  if (!next) return null;
  snap.state = next.state;
  snap.questionIndex = next.questionIndex;
  return { snap, nextIndex: next.questionIndex };
}

export async function hostStartQuestion(pin: string): Promise<void> {
  const result = await advance(pin, "HOST_START_QUESTION");
  if (!result) return;
  const { snap, nextIndex } = result;
  const q = snap.questions[nextIndex];
  if (!q) return;

  // Standings *before* this question — the baseline for the ▲/▼ arrows shown
  // on the scoreboard after it. Captured here (not when the scoreboard is
  // published) so a client reconnecting mid-scoreboard still sees the movement.
  //
  // Skipped for the opening question: everyone is on zero, so the "ranks" are
  // just an alphabetical tie-break and diffing against them would show players
  // moving up and down for no reason.
  if (nextIndex > 0) {
    await store.savePreviousRanks(pin, await buildLeaderboard(pin));
  }

  const askedAt = Date.now();
  const deadline = askedAt + q.timeLimitSeconds * 1000;
  snap.current = { questionId: q.id, index: nextIndex, askedAt, deadline };
  await store.saveSnapshot(snap);

  scheduleLock(pin, deadline - askedAt);

  logGame("question_open", {
    pin,
    questionId: q.id,
    index: nextIndex,
    total: snap.totalQuestions,
    kind: q.kind,
    deadline,
    timeLimitSeconds: q.timeLimitSeconds,
  });

  const view = questionView(snap, snap.current);
  if (view) publish(pin, { type: "QUESTION_SHOWN", question: view });
}

export async function hostNext(pin: string): Promise<void> {
  const snap = await store.loadSnapshot(pin);
  if (!snap) return;

  if (snap.state === "REVEAL") {
    const result = await advance(pin, "HOST_NEXT");
    if (!result) return;
    await store.saveSnapshot(result.snap);
    publish(pin, {
      type: "LEADERBOARD",
      leaderboard: await buildLeaderboard(pin, LEADERBOARD_SIZE),
      final: false,
    });
    return;
  }

  if (snap.state === "LEADERBOARD") {
    const result = await advance(pin, "HOST_NEXT"); // -> ENDED
    if (!result) return;
    await store.saveSnapshot(result.snap);
    await endGame(pin);
  }
}

// ---------------------------------------------------------------------------
// Locking + scoring
// ---------------------------------------------------------------------------

function scheduleLock(pin: string, ms: number): void {
  clearTimeout(lockTimers.get(pin));
  lockTimers.set(
    pin,
    setTimeout(
      () => {
        lockTimers.delete(pin);
        void lockAndScore(pin).catch((err) =>
          logError("lock_and_score_failed", err, { pin }),
        );
      },
      Math.max(0, ms),
    ),
  );
}

export async function lockAndScore(pin: string): Promise<void> {
  // Identify the question first so the claim below can be keyed on it.
  const pre = await store.loadSnapshot(pin);
  if (!pre || pre.state !== "QUESTION_ACTIVE" || !pre.current) return;

  // Exactly one caller may score a given question. The state guard inside
  // advance() is NOT enough: it reads the snapshot, checks, and only later does
  // the caller save, so an entire class answering at once slips through the gap
  // and scores the room once per answer. The claim is a primary-key insert, so
  // exactly one caller can win it.
  if (!(await store.claimScoring(pin, pre.current.index))) return;

  const locked = await advance(pin, "LOCK");
  if (!locked) return; // someone already closed this question
  clearTimeout(lockTimers.get(pin));
  lockTimers.delete(pin);
  await store.saveSnapshot(locked.snap);

  const snap = locked.snap;
  const current = snap.current;
  const question = current ? snap.questions[current.index] : undefined;
  if (!current || !question) return;

  const answers = await store.getAnswers(pin, current.index);
  const tally = new Array<number>(question.choices.length).fill(0);

  for (const [playerId, answer] of Object.entries(answers)) {
    if (answer.choiceIndex >= 0 && answer.choiceIndex < tally.length) {
      tally[answer.choiceIndex] = (tally[answer.choiceIndex] ?? 0) + 1;
    }
    const correct = answer.choiceIndex === question.correctIndex;
    const points = computeScore({
      correct,
      askedAt: current.askedAt,
      deadline: current.deadline,
      answeredAt: answer.answeredAt,
      maxPoints: question.maxPoints,
    });

    const totalScore =
      points > 0
        ? await store.addScore(pin, playerId, points)
        : await store.getScore(pin, playerId);
    if (correct) await store.bumpCorrect(pin, playerId);
    await store.appendLog(pin, playerId, {
      questionId: question.id,
      choiceIndex: answer.choiceIndex,
      correct,
      points,
    });

    publish(playerTopic(playerId), {
      type: "ANSWER_RESULT",
      questionId: question.id,
      correct,
      pointsAwarded: points,
      totalScore,
    });
  }

  const revealed = await advance(pin, "SCORED");
  if (revealed) await store.saveSnapshot(revealed.snap);

  const answerCount = Object.keys(answers).length;
  logGame("question_close", {
    pin,
    questionId: question.id,
    index: current.index,
    correctIndex: question.correctIndex,
    answers: answerCount,
    correctAnswers: tally[question.correctIndex] ?? 0,
    /** how far past the deadline the close actually fired — timer accuracy */
    lateByMs: Date.now() - current.deadline,
  });

  publish(pin, {
    type: "QUESTION_CLOSED",
    questionId: question.id,
    correctIndex: question.correctIndex,
    tally,
  });
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export async function buildLeaderboard(
  pin: string,
  limit?: number,
): Promise<LeaderboardRow[]> {
  const [scores, players, previous] = await Promise.all([
    store.getScores(pin),
    store.getPlayers(pin),
    store.getPreviousRanks(pin),
  ]);
  const rows: LeaderboardRow[] = Object.entries(players)
    .map(([playerId, player]) => ({
      playerId,
      nickname: player.nickname,
      // sessions started before avatars existed have none
      avatar: player.avatar ?? DEFAULT_AVATAR,
      score: scores[playerId] ?? 0,
      rank: 0,
      previousRank: previous[playerId] ?? null,
    }))
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));

  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return limit ? rows.slice(0, limit) : rows;
}

// ---------------------------------------------------------------------------
// Ending — the ONLY write of game data to the durable tables
// ---------------------------------------------------------------------------

export async function endGame(pin: string): Promise<void> {
  const snap = await store.loadSnapshot(pin);
  if (!snap) return;

  const [rows, correct, log] = await Promise.all([
    buildLeaderboard(pin),
    store.getCorrectCounts(pin),
    store.getLog(pin),
  ]);

  if (rows.length > 0) {
    const resultRows = rows.map((row) => ({
      session_id: snap.sessionId,
      player_id: row.playerId,
      nickname: row.nickname,
      avatar: row.avatar,
      final_score: row.score,
      final_rank: row.rank,
      correct_count: correct[row.playerId] ?? 0,
      answers: log[row.playerId] ?? [],
    }));

    // The single write of game data to durable storage — results and the
    // session's closure commit together or not at all.
    tx(() => {
      for (const row of resultRows) {
        run(
          `insert into game_results
             (id, session_id, player_id, nickname, avatar, final_score,
              final_rank, correct_count, answers)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          crypto.randomUUID(),
          row.session_id,
          row.player_id,
          row.nickname,
          row.avatar,
          row.final_score,
          row.final_rank,
          row.correct_count,
          JSON.stringify(row.answers),
        );
      }
      run(
        "update game_sessions set status = 'ended', ended_at = ? where id = ?",
        nowIso(),
        snap.sessionId,
      );
    });
  } else {
    run(
      "update game_sessions set status = 'ended', ended_at = ? where id = ?",
      nowIso(),
      snap.sessionId,
    );
  }

  logGame("game_end", {
    pin,
    sessionId: snap.sessionId,
    quizId: snap.quizId,
    players: rows.length,
    questions: snap.totalQuestions,
    winner: rows[0]?.nickname ?? null,
    topScore: rows[0]?.score ?? 0,
  });

  publish(pin, {
    type: "GAME_ENDED",
    leaderboard: rows.slice(0, LEADERBOARD_SIZE),
  });

  clearTimeout(lockTimers.get(pin));
  lockTimers.delete(pin);
  await store.purge(pin);
}

// ---------------------------------------------------------------------------
// Restart safety
// ---------------------------------------------------------------------------

/** Rebuild auto-close timers after a server restart so no in-flight question hangs. */
export async function rehydrate(): Promise<void> {
  const pins = await store.activePins();
  for (const pin of pins) {
    const snap = await store.loadSnapshot(pin);
    if (!snap) {
      await store.forgetActive(pin);
      continue;
    }
    if (snap.state === "QUESTION_ACTIVE" && snap.current) {
      const remaining = snap.current.deadline - Date.now();
      if (remaining <= 0) await lockAndScore(pin);
      else scheduleLock(pin, remaining);
    }
  }
  if (pins.length) console.log(`rehydrated ${pins.length} active game(s)`);
}

export function broadcast(pin: string, message: ServerToClient): void {
  publish(pin, message);
}
