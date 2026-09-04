import type { LeaderboardRow } from "@shared/protocol";
import { RankDelta } from "./RankDelta";

export function Leaderboard({
  rows,
  highlightId,
  limit = 8,
}: {
  rows: LeaderboardRow[];
  highlightId?: string | null;
  limit?: number;
}) {
  return (
    <ol className="leaderboard">
      {rows.slice(0, limit).map((r) => (
        <li
          key={r.playerId}
          className={r.playerId === highlightId ? "me" : undefined}
        >
          <span className="rank">{r.rank}</span>
          <span className="nick">
            <span className="avatar-chip">{r.avatar}</span>
            {r.nickname}
          </span>
          <RankDelta row={r} />
          <span className="score">{r.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
