/**
 * Auto-assigned names for students who join without typing one.
 *
 * Generated on the server so the name a player is known by has exactly one
 * source of truth, and so two silent joiners can't collide on the client.
 */
const NAMES = [
  "Layla",
  "Miya",
  "Gusion",
  "Fanny",
  "Alucard",
  "Nana",
  "Zilong",
  "Eudora",
  "Kagura",
  "Hayabusa",
  "Granger",
  "Odette",
  "Lesley",
  "Chou",
  "Selena",
  "Harith",
  "Ling",
  "Aurora",
  "Cyclops",
  "Balmond",
];

/**
 * `Name` + a 2-digit number, avoiding anything already in the room. Falls back
 * to a wider number range if a small room somehow exhausts the obvious picks.
 */
export function randomNickname(taken: Iterable<string> = []): string {
  const used = new Set(Array.from(taken, (n) => n.toLowerCase()));
  for (let attempt = 0; attempt < 40; attempt++) {
    const name = NAMES[Math.floor(Math.random() * NAMES.length)]!;
    const n = 10 + Math.floor(Math.random() * 90);
    const candidate = `${name}${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `Player${Date.now().toString().slice(-5)}`;
}

/** A random animal avatar for players who didn't pick one. */
export function randomAvatar<T>(avatars: readonly T[]): T {
  return avatars[Math.floor(Math.random() * avatars.length)]!;
}
