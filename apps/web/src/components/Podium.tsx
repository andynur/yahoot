import type { LeaderboardRow } from "@shared/protocol";

const MEDAL = ["🥇", "🥈", "🥉"];

export function Podium({ rows }: { rows: LeaderboardRow[] }) {
  const top = rows.slice(0, 3);
  const rest = rows.slice(3, 8);
  // Visual order: 2nd, 1st, 3rd — tallest in the middle.
  const order = [top[1], top[0], top[2]].filter(Boolean) as LeaderboardRow[];

  return (
    <div className="podium-wrap">
      <div className="podium">
        {order.map((row) => (
          <div key={row.playerId} className={`podium-step place-${row.rank}`}>
            <div className="podium-avatar">{row.avatar}</div>
            <div className="podium-name">
              {MEDAL[row.rank - 1]} {row.nickname}
            </div>
            <div className="podium-score">{row.score}</div>
            <div className="podium-block">{row.rank}</div>
          </div>
        ))}
      </div>

      {rest.length > 0 && (
        <ol className="runners" start={4}>
          {rest.map((row) => (
            <li key={row.playerId}>
              <span className="rank">{row.rank}</span>
              <span className="nick">
                <span className="avatar-chip">{row.avatar}</span>
                {row.nickname}
              </span>
              <span className="score">{row.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
