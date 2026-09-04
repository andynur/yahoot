/**
 * Forward-only migration runner. Applies every `db/migrations/NNN_*.sql` that
 * hasn't been recorded yet, in filename order, each in its own transaction.
 *
 *   bun run db:migrate
 *
 * Idempotent, so the container can run it on every boot.
 */
import { Glob } from "bun";
import { db, nowIso, run, tx } from "./db";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url).pathname;

export async function migrate(log = true): Promise<number> {
  run(`create table if not exists _migrations (
        name       text primary key,
        applied_at text not null
      )`);

  const applied = new Set(
    db
      .query("select name from _migrations")
      .all()
      .map((r) => (r as { name: string }).name),
  );

  const files = [...new Glob("*.sql").scanSync({ cwd: MIGRATIONS_DIR })].sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const ddl = await Bun.file(MIGRATIONS_DIR + file).text();
    if (log) process.stdout.write(`applying ${file} ... `);
    // The DDL and its bookkeeping row commit together, or not at all.
    tx(() => {
      db.exec(ddl);
      run(
        "insert into _migrations (name, applied_at) values (?, ?)",
        file,
        nowIso(),
      );
    });
    if (log) console.log("ok");
    ran++;
  }
  return ran;
}

if (import.meta.main) {
  const ran = await migrate();
  console.log(ran === 0 ? "already up to date" : `applied ${ran} migration(s)`);
}
