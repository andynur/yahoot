/**
 * Pure scoring. No I/O, no clock reads — every value is passed in so the server
 * (the ONLY place this runs) stays deterministic and testable.
 *
 * Deviation from the init sketch: the sketch listed
 * `{ correct, deadline, answeredAt, maxPoints }`. "Time remaining" only becomes a
 * fraction once you know the window it lives in, so `askedAt` (when the question
 * was shown) is passed too. Everything is server-clock epoch-ms.
 */
export interface ComputeScoreArgs {
  /** did the player pick the correct choice */
  correct: boolean;
  /** epoch-ms the question was shown to the room */
  askedAt: number;
  /** epoch-ms answers close (always strictly after askedAt) */
  deadline: number;
  /** epoch-ms the server accepted this player's answer */
  answeredAt: number;
  /** points a correct, instant answer is worth */
  maxPoints: number;
}

/**
 * Correct answers always earn at least half of `maxPoints`; the other half is
 * scaled linearly by how much of the question window was left when the answer
 * landed. Wrong or late answers earn nothing.
 */
export function computeScore({
  correct,
  askedAt,
  deadline,
  answeredAt,
  maxPoints,
}: ComputeScoreArgs): number {
  if (!correct) return 0;
  if (answeredAt >= deadline) return 0; // late — server already rejected it too

  const window = Math.max(1, deadline - askedAt);
  const elapsed = Math.min(Math.max(answeredAt - askedAt, 0), window);
  const speedFraction = 1 - elapsed / window; // 1 = instant, 0 = at the buzzer

  return Math.round(maxPoints * (0.5 + 0.5 * speedFraction));
}
