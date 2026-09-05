import { useEffect, useState } from "react";
import type { LeaderboardRow } from "@shared/protocol";
import { api, type PublicResults as Results } from "../api";
import { Podium } from "../components/Podium";
import { usePath } from "../router";
import { useQuizTheme } from "../theme";

/**
 * The page behind a shared result link: /r/<token>.
 *
 * Public and unauthenticated — the token is the only credential, so there is no
 * sign-in here and nothing to look up by guessing. Students open it after the
 * lesson to find where they came.
 */
export function PublicResults() {
  const path = usePath();
  const token = decodeURIComponent(path.split("/")[2] ?? "");

  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!token) {
      setError("This link is incomplete.");
      return;
    }
    api
      .getPublicResults(token)
      .then((res) => live && setData(res))
      .catch((err: unknown) => {
        if (!live) return;
        setError(
          err instanceof Error ? err.message : "could not load these results",
        );
      });
    return () => {
      live = false;
    };
  }, [token]);

  useQuizTheme(data?.theme);

  if (error) {
    return (
      <div className="grow stack center">
        <h1 className="huge on-purple">Nothing here</h1>
        <p className="on-purple">
          {error} The teacher may have withdrawn the link.
        </p>
        <a className="btn ghost lg" href="/">
          Go to Yahoot
        </a>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grow stack center">
        <p className="on-purple">Loading results…</p>
      </div>
    );
  }

  // The podium component speaks leaderboard rows. A published page has no
  // player ids (they double as rejoin credentials) and no rank history, so the
  // rank stands in as the key and there is no movement to show.
  const rows: LeaderboardRow[] = data.players.map((p) => ({
    playerId: `r${p.rank}`,
    nickname: p.nickname,
    avatar: p.avatar,
    score: p.score,
    rank: p.rank,
    previousRank: null,
  }));

  const ended = data.endedAt ? new Date(data.endedAt) : null;

  return (
    <div className="grow stack center public-results">
      <h1 className="huge on-purple pop-in">🏆 {data.quizTitle}</h1>
      <p className="on-purple">
        {data.players.length} {data.players.length === 1 ? "player" : "players"}{" "}
        · {data.questionCount}{" "}
        {data.questionCount === 1 ? "question" : "questions"}
        {ended && !Number.isNaN(ended.getTime())
          ? ` · ${ended.toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}`
          : ""}
      </p>

      {/* Top three only: the Podium component also lists 4th–8th, which would
          repeat the full scoreboard below it. */}
      <Podium rows={rows.slice(0, 3)} />

      {data.players.length > 3 && (
        <section className="panel">
          <h3 className="settings-title">Full scoreboard</h3>
          <table className="report-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Correct</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {data.players.map((p) => (
                <tr key={`${p.rank}-${p.nickname}`}>
                  <td>{p.rank}</td>
                  <td>
                    <span className="avatar-chip">{p.avatar}</span> {p.nickname}
                  </td>
                  <td>
                    {p.correctCount}/{data.questionCount}
                  </td>
                  <td>
                    <strong>{p.score.toLocaleString()}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <a className="btn ghost lg" href="/">
        Play Yahoot
      </a>
    </div>
  );
}
