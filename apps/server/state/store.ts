/**
 * Live game state, in SQLite.
 *
 * Architecture rule: the running game lives HERE, not in server memory. A
 * restart mid-game reloads everything from these tables (see engine.rehydrate).
 * On disk this is *more* restart-safe than an unconfigured Redis would be, and
 * it costs a school one less service to run.
 *
 * Every function is `async` even though bun:sqlite is synchronous, so the
 * engine's call sites are unchanged. The synchrony is a real benefit: a
 * read-check-write inside one function cannot interleave with another request.
 *
 * Tables (all prefixed `live_`, all dropped by `purge`):
 *   live_games       pin -> JSON Snapshot (state, current question, timing)
 *   live_players     (pin, player_id) -> nickname, avatar
 *   live_scores      (pin, player_id) -> running score + correct count
 *   live_answers     (pin, question_index, player_id) -> choice, answered_at
 *   live_log         (pin, player_id) -> JSON AnswerLogEntry[] for final results
 *   live_prev_ranks  (pin, player_id) -> rank before the current question
 *   live_scored      (pin, question_index) -> the exactly-once scoring claim
 *   live_active      pins with a session that isn't ended
 */
import { all, fromJson, get, run, toJson, tx } from "../db/db";
import type {
  AnswerLogEntry,
  AnswerRecord,
  PlayerRecord,
  Snapshot,
} from "../game/types";

/** Abandoned games are swept after this long. Replaces Redis key expiry. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

// --- snapshot ---------------------------------------------------------------

export async function saveSnapshot(snap: Snapshot): Promise<void> {
  run(
    `insert into live_games (pin, snapshot, updated_at) values (?, ?, ?)
     on conflict (pin) do update set snapshot = excluded.snapshot,
                                     updated_at = excluded.updated_at`,
    snap.pin,
    toJson(snap),
    Date.now(),
  );
}

export async function loadSnapshot(pin: string): Promise<Snapshot | null> {
  const row = get<{ snapshot: string }>(
    "select snapshot from live_games where pin = ?",
    pin,
  );
  return row ? fromJson<Snapshot | null>(row.snapshot, null) : null;
}

// --- active registry --------------------------------------------------------

export async function registerActive(pin: string): Promise<void> {
  run("insert or ignore into live_active (pin) values (?)", pin);
}

export async function activePins(): Promise<string[]> {
  return all<{ pin: string }>("select pin from live_active").map((r) => r.pin);
}

export async function forgetActive(pin: string): Promise<void> {
  run("delete from live_active where pin = ?", pin);
}

// --- players ----------------------------------------------------------------

export async function addPlayer(
  pin: string,
  playerId: string,
  record: PlayerRecord,
): Promise<void> {
  run(
    `insert into live_players (pin, player_id, nickname, avatar, joined_at)
     values (?, ?, ?, ?, ?)
     on conflict (pin, player_id) do update set nickname = excluded.nickname,
                                                avatar   = excluded.avatar`,
    pin,
    playerId,
    record.nickname,
    record.avatar,
    record.joinedAt,
  );
}

export async function getPlayer(
  pin: string,
  playerId: string,
): Promise<PlayerRecord | null> {
  const row = get<{ nickname: string; avatar: string; joined_at: number }>(
    "select nickname, avatar, joined_at from live_players where pin = ? and player_id = ?",
    pin,
    playerId,
  );
  return row
    ? { nickname: row.nickname, avatar: row.avatar, joinedAt: row.joined_at }
    : null;
}

export async function getPlayers(
  pin: string,
): Promise<Record<string, PlayerRecord>> {
  const rows = all<{
    player_id: string;
    nickname: string;
    avatar: string;
    joined_at: number;
  }>(
    "select player_id, nickname, avatar, joined_at from live_players where pin = ?",
    pin,
  );
  const out: Record<string, PlayerRecord> = {};
  for (const r of rows) {
    out[r.player_id] = {
      nickname: r.nickname,
      avatar: r.avatar,
      joinedAt: r.joined_at,
    };
  }
  return out;
}

export async function playerCount(pin: string): Promise<number> {
  return (
    get<{ n: number }>(
      "select count(*) as n from live_players where pin = ?",
      pin,
    )?.n ?? 0
  );
}

// --- answers ----------------------------------------------------------------

/** Write-once: a second answer for the same question returns false. */
export async function recordAnswer(
  pin: string,
  questionIndex: number,
  playerId: string,
  record: AnswerRecord,
): Promise<boolean> {
  const changed = run(
    `insert or ignore into live_answers
       (pin, question_index, player_id, choice_index, answered_at)
     values (?, ?, ?, ?, ?)`,
    pin,
    questionIndex,
    playerId,
    record.choiceIndex,
    record.answeredAt,
  );
  return changed > 0;
}

export async function hasAnswered(
  pin: string,
  questionIndex: number,
  playerId: string,
): Promise<boolean> {
  return (
    get<{ n: number }>(
      "select count(*) as n from live_answers where pin = ? and question_index = ? and player_id = ?",
      pin,
      questionIndex,
      playerId,
    )?.n === 1
  );
}

export async function getAnswers(
  pin: string,
  questionIndex: number,
): Promise<Record<string, AnswerRecord>> {
  const rows = all<{
    player_id: string;
    choice_index: number;
    answered_at: number;
  }>(
    "select player_id, choice_index, answered_at from live_answers where pin = ? and question_index = ?",
    pin,
    questionIndex,
  );
  const out: Record<string, AnswerRecord> = {};
  for (const r of rows) {
    out[r.player_id] = {
      choiceIndex: r.choice_index,
      answeredAt: r.answered_at,
    };
  }
  return out;
}

// --- scores -----------------------------------------------------------------

export async function addScore(
  pin: string,
  playerId: string,
  points: number,
): Promise<number> {
  const row = get<{ score: number }>(
    `insert into live_scores (pin, player_id, score) values (?, ?, ?)
     on conflict (pin, player_id) do update set score = score + excluded.score
     returning score`,
    pin,
    playerId,
    points,
  );
  return row?.score ?? 0;
}

export async function bumpCorrect(
  pin: string,
  playerId: string,
): Promise<void> {
  run(
    `insert into live_scores (pin, player_id, correct_count) values (?, ?, 1)
     on conflict (pin, player_id) do update set correct_count = correct_count + 1`,
    pin,
    playerId,
  );
}

export async function getScore(pin: string, playerId: string): Promise<number> {
  return (
    get<{ score: number }>(
      "select score from live_scores where pin = ? and player_id = ?",
      pin,
      playerId,
    )?.score ?? 0
  );
}

export async function getScores(pin: string): Promise<Record<string, number>> {
  const rows = all<{ player_id: string; score: number }>(
    "select player_id, score from live_scores where pin = ?",
    pin,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.player_id] = r.score;
  return out;
}

export async function getCorrectCounts(
  pin: string,
): Promise<Record<string, number>> {
  const rows = all<{ player_id: string; correct_count: number }>(
    "select player_id, correct_count from live_scores where pin = ?",
    pin,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.player_id] = r.correct_count;
  return out;
}

// --- per-player answer log (becomes the persisted result) -------------------

export async function appendLog(
  pin: string,
  playerId: string,
  entry: AnswerLogEntry,
): Promise<void> {
  // Read-modify-write is safe here: bun:sqlite is synchronous, so nothing can
  // interleave between the read and the write inside this transaction.
  tx(() => {
    const row = get<{ entries: string }>(
      "select entries from live_log where pin = ? and player_id = ?",
      pin,
      playerId,
    );
    const entries = row ? fromJson<AnswerLogEntry[]>(row.entries, []) : [];
    entries.push(entry);
    run(
      `insert into live_log (pin, player_id, entries) values (?, ?, ?)
       on conflict (pin, player_id) do update set entries = excluded.entries`,
      pin,
      playerId,
      toJson(entries),
    );
  });
}

export async function getLog(
  pin: string,
): Promise<Record<string, AnswerLogEntry[]>> {
  const rows = all<{ player_id: string; entries: string }>(
    "select player_id, entries from live_log where pin = ?",
    pin,
  );
  const out: Record<string, AnswerLogEntry[]> = {};
  for (const r of rows)
    out[r.player_id] = fromJson<AnswerLogEntry[]>(r.entries, []);
  return out;
}

// --- rank history (the ▲/▼ movement on the scoreboard) ----------------------

export async function getPreviousRanks(
  pin: string,
): Promise<Record<string, number>> {
  const rows = all<{ player_id: string; rank: number }>(
    "select player_id, rank from live_prev_ranks where pin = ?",
    pin,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.player_id] = r.rank;
  return out;
}

export async function savePreviousRanks(
  pin: string,
  ranks: Array<{ playerId: string; rank: number }>,
): Promise<void> {
  if (ranks.length === 0) return;
  tx(() => {
    run("delete from live_prev_ranks where pin = ?", pin);
    for (const { playerId, rank } of ranks) {
      run(
        "insert into live_prev_ranks (pin, player_id, rank) values (?, ?, ?)",
        pin,
        playerId,
        rank,
      );
    }
  });
}

// --- exactly-once scoring ---------------------------------------------------

/**
 * Claim the right to score question `index`. True for exactly one caller.
 *
 * The primary key on (pin, question_index) is what enforces it: a second insert
 * changes no rows. Without this, an entire class answering in the same burst
 * scored the whole room once per answer.
 */
export async function claimScoring(
  pin: string,
  index: number,
): Promise<boolean> {
  return (
    run(
      "insert or ignore into live_scored (pin, question_index) values (?, ?)",
      pin,
      index,
    ) > 0
  );
}

// --- cleanup ----------------------------------------------------------------

const LIVE_TABLES = [
  "live_games",
  "live_players",
  "live_scores",
  "live_answers",
  "live_log",
  "live_prev_ranks",
  "live_scored",
] as const;

/** Drop every live row for a game. Called after results are persisted. */
export async function purge(pin: string): Promise<void> {
  tx(() => {
    for (const table of LIVE_TABLES)
      run(`delete from ${table} where pin = ?`, pin);
    run("delete from live_active where pin = ?", pin);
  });
}

/**
 * Remove games that were abandoned (host closed the tab, never finished).
 * Redis did this with key TTLs; here it is an explicit sweep at boot.
 */
export async function sweepStale(): Promise<number> {
  const cutoff = Date.now() - STALE_AFTER_MS;
  const stale = all<{ pin: string }>(
    "select pin from live_games where updated_at < ?",
    cutoff,
  ).map((r) => r.pin);
  for (const pin of stale) await purge(pin);
  return stale.length;
}
