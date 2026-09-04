/**
 * Guards the "build the frontend locally, commit it, deploy only the backend"
 * workflow: if apps/web/src changed after apps/web/dist was built, the deploy
 * would silently ship a stale UI.
 *
 *   bun run check:web
 */
import { Glob } from "bun";

const root = new URL("../apps/web/", import.meta.url).pathname;

async function newest(dir: string, pattern: string): Promise<number> {
  let latest = 0;
  for await (const rel of new Glob(pattern).scan({ cwd: dir })) {
    const stat = await Bun.file(dir + rel).stat();
    latest = Math.max(latest, stat.mtimeMs);
  }
  return latest;
}

const sourceAt = Math.max(
  await newest(root, "src/**/*"),
  await newest(root, "index.html"),
);
const builtAt = await newest(root, "dist/**/*");

if (builtAt === 0) {
  console.error("✗ apps/web/dist is empty — run: bun run build:web");
  process.exit(1);
}
if (sourceAt > builtAt) {
  const mins = Math.round((sourceAt - builtAt) / 60000);
  console.error(
    `✗ apps/web/src is ${mins} minute(s) newer than apps/web/dist.\n` +
      "  The deploy ships dist, so this would serve a stale UI.\n" +
      "  Run: bun run build:web  (then commit apps/web/dist)",
  );
  process.exit(1);
}
console.log("✓ apps/web/dist is up to date with apps/web/src");
