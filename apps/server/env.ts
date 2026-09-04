/** Central env access. Throws loudly at boot if a required var is missing. */
import { isAbsolute, resolve } from "node:path";

/**
 * The repo root, derived from this file rather than from `process.cwd()`.
 *
 * It matters: `bun dev` starts the server with its cwd at apps/server, while
 * `bun run db:seed` runs from the repo root. A relative DATABASE_PATH resolved
 * against the cwd therefore means two *different* database files — the seed
 * lands somewhere the server never opens, and logging in fails with no clue
 * why. Anchoring here makes "./data/yahoot.db" mean one file, always.
 */
const REPO_ROOT = resolve(import.meta.dir, "../..");

function resolveFromRepo(path: string): string {
  return isAbsolute(path) ? path : resolve(REPO_ROOT, path);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing required env var: ${name} (see .env.example)`);
  return value;
}

export const env = {
  /**
   * Path to the SQLite file. One file holds accounts, quizzes, results and live
   * game state — back it up by copying it. In Docker this must sit on a volume.
   */
  DATABASE_PATH: resolveFromRepo(
    process.env.DATABASE_PATH ?? "./data/yahoot.db",
  ),
  JWT_SECRET: required("JWT_SECRET"),
  // PORT is what most PaaS hosts (Easypanel, Railway, Fly…) inject.
  SERVER_PORT: Number(process.env.PORT ?? process.env.SERVER_PORT ?? 3020),
  /** Set to "production" in the container; tightens CORS. */
  NODE_ENV: process.env.NODE_ENV ?? "development",
  IS_PRODUCTION: (process.env.NODE_ENV ?? "development") === "production",
  /** Origin the browser app is served from — used for dev CORS. */
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://localhost:3001",
} as const;
