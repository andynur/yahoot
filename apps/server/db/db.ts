/**
 * The one SQLite database — accounts, quizzes, results *and* live game state.
 *
 * Why SQLite rather than Postgres + Redis: this app is already pinned to a
 * single process (Bun's WebSocket pub/sub is per-process), so a networked
 * database buys nothing and costs two services a school has to run. Reads and
 * writes here are in-process function calls, backups are `cp yahoot.db`, and a
 * self-hosted deploy is one container with one file.
 *
 * A useful side effect: bun:sqlite is synchronous, so a read-check-write inside
 * one function cannot interleave with another request. The class of bug where
 * 80 simultaneous answers each scored the whole room is structurally impossible.
 */
import { Database, type Statement } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../env";

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });

export const db = new Database(env.DATABASE_PATH, { create: true });

// WAL lets readers run while a write is in flight — the right mode for a server.
db.exec("PRAGMA journal_mode = WAL");
// NORMAL is the documented companion to WAL: durable across process crashes,
// and only at risk from an OS-level crash mid-write.
db.exec("PRAGMA synchronous = NORMAL");
// Wait rather than immediately erroring if another connection holds the lock.
db.exec("PRAGMA busy_timeout = 5000");
// Off by default in SQLite; the schema relies on ON DELETE CASCADE.
db.exec("PRAGMA foreign_keys = ON");

/**
 * Prepared statements, kept for the life of the process.
 *
 * `db.query()` has its own cache, but it holds only ~20 statements and this
 * server issues ~60 distinct ones, so the hot path evicted and re-prepared on
 * nearly every call. Measured over 20k queries across 30 statements:
 * 131 ms via `db.query()` vs 45 ms here — SQLite re-parsing the SQL was the
 * dominant cost, not the lookup itself.
 *
 * Unbounded on purpose, and safe to be: every string that reaches here is a
 * literal in this repo, so the key set is finite and small. **Do not build SQL
 * by interpolating values** — you would both leak memory here and lose the
 * parameter binding that keeps injection impossible. Interpolate only fixed
 * identifiers from a constant list (see `purge()` in state/store.ts).
 */
const prepared = new Map<string, Statement>();

function stmt(sql: string): Statement {
  let s = prepared.get(sql);
  if (!s) prepared.set(sql, (s = db.prepare(sql)));
  return s;
}

export function all<T>(sql: string, ...params: unknown[]): T[] {
  return stmt(sql).all(...(params as never[])) as T[];
}

export function get<T>(sql: string, ...params: unknown[]): T | null {
  return (stmt(sql).get(...(params as never[])) as T) ?? null;
}

/** Returns the number of rows the statement changed. */
export function run(sql: string, ...params: unknown[]): number {
  return stmt(sql).run(...(params as never[])).changes;
}

/** Runs `fn` in a transaction; it rolls back if `fn` throws. */
export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}

/** JSON columns are TEXT — SQLite has no jsonb. */
export const toJson = (value: unknown): string => JSON.stringify(value);
export function fromJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** ISO-8601 UTC, so `new Date(row.created_at)` works in the browser. */
export const nowIso = (): string => new Date().toISOString();
