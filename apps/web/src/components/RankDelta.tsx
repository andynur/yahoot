import type { LeaderboardRow } from "@shared/protocol";

/**
 * ▲3 / ▼1 movement since the previous question.
 *
 * A *smaller* rank number is better, so moving from 4th to 1st is `previousRank
 * - rank = 3` places gained. Renders nothing on the first scoreboard (no
 * baseline) or when a player held their place.
 */
export function RankDelta({ row }: { row: LeaderboardRow }) {
  if (row.previousRank === null) return null;

  const moved = row.previousRank - row.rank;
  if (moved === 0) {
    return (
      <span className="rank-delta same" title="No change">
        –
      </span>
    );
  }

  const up = moved > 0;
  return (
    <span
      className={`rank-delta ${up ? "up" : "down"}`}
      title={`${up ? "Up" : "Down"} ${Math.abs(moved)} place${
        Math.abs(moved) === 1 ? "" : "s"
      }`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(moved)}
    </span>
  );
}
