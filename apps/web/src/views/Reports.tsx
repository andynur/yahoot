import { useEffect, useState } from "react";
import { api, type SessionReport, type SessionSummary } from "../api";
import { downloadText, toCsv } from "../download";

/** Past games: which classes played, and which questions they struggled with. */
export function Reports({ onBack }: { onBack: () => void }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [open, setOpen] = useState<SessionReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSessions()
      .then((r) => setSessions(r.sessions))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "could not load sessions"),
      );
  }, []);

  if (open) {
    return <ReportDetail report={open} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="screen">
      <header className="row between">
        <h1 className="brand sm">Reports</h1>
        <button className="link" onClick={onBack}>
          Back to quizzes
        </button>
      </header>

      {error && <p className="notice warn">{error}</p>}
      {sessions?.length === 0 && (
        <p className="on-purple">
          No games played yet. Host one and the report will show up here.
        </p>
      )}

      <div className="quiz-list">
        {sessions?.map((s) => (
          <div key={s.id} className="quiz-row">
            <div className="quiz-row-main">
              <strong>{s.quizTitle}</strong>
              <span className="muted">
                PIN {s.pin} · {formatWhen(s.endedAt ?? s.createdAt)} ·{" "}
                {s.playerCount} player{s.playerCount === 1 ? "" : "s"}
                {s.status !== "ended" && " · still open"}
              </span>
            </div>
            <button
              className="btn green"
              disabled={s.playerCount === 0}
              title={
                s.playerCount === 0 ? "Nobody finished this game" : undefined
              }
              onClick={async () => {
                setError(null);
                try {
                  setOpen(await api.getSessionReport(s.id));
                } catch (e) {
                  setError(e instanceof Error ? e.message : "load failed");
                }
              }}
            >
              View report
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportDetail({
  report,
  onBack,
}: {
  report: SessionReport;
  onBack: () => void;
}) {
  const { session, results, questions } = report;

  const exportCsv = () => {
    const rows: unknown[][] = [
      ["Quiz", session.quizTitle],
      ["PIN", session.pin],
      ["Played", formatWhen(session.endedAt ?? session.createdAt)],
      [],
      ["Rank", "Nickname", "Score", "Correct answers"],
      ...results.map((r) => [r.rank, r.nickname, r.score, r.correctCount]),
      [],
      ["#", "Question", "Answered", "Correct", "Correct %", "Avg points"],
      ...questions.map((q) => [
        q.index + 1,
        q.prompt,
        q.answered,
        q.correct,
        q.correctPct,
        q.averagePoints,
      ]),
    ];
    downloadText(`report-${session.pin}.csv`, toCsv(rows));
  };

  // Anything under half the class getting it right is worth a second look.
  const hardest = [...questions].sort((a, b) => a.correctPct - b.correctPct)[0];

  return (
    <div className="screen">
      <header className="row between">
        <h1 className="brand sm">{session.quizTitle}</h1>
        <button className="link" onClick={onBack}>
          All reports
        </button>
      </header>
      <p className="on-purple">
        PIN {session.pin} · {formatWhen(session.endedAt ?? session.createdAt)} ·{" "}
        {results.length} player{results.length === 1 ? "" : "s"}
      </p>

      {hardest && hardest.correctPct < 50 && (
        <div className="notice warn">
          Hardest question ({hardest.correctPct}% correct): “{hardest.prompt}”
        </div>
      )}

      <section className="panel">
        <h3 className="settings-title">Final standings</h3>
        <table className="report-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Nickname</th>
              <th>Correct</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.playerId}>
                <td>{r.rank}</td>
                <td>{r.nickname}</td>
                <td>
                  {r.correctCount}/{questions.length}
                </td>
                <td>
                  <strong>{r.score.toLocaleString()}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3 className="settings-title">Per-question breakdown</h3>
        <div className="stack">
          {questions.map((q) => (
            <div key={q.questionId} className="qstat">
              <div className="qstat-head">
                <span className="q-badge">Q{q.index + 1}</span>
                <span className="qstat-prompt">{q.prompt}</span>
                <span className={`qstat-pct${q.correctPct < 50 ? " low" : ""}`}>
                  {q.correctPct}%
                </span>
              </div>
              <div className="qstat-bar">
                <div
                  className={`qstat-fill${q.correctPct < 50 ? " low" : ""}`}
                  style={{ width: `${q.correctPct}%` }}
                />
              </div>
              <span className="muted">
                {q.correct} of {q.answered} correct · avg{" "}
                {q.averagePoints.toLocaleString()} pts
              </span>
            </div>
          ))}
        </div>
      </section>

      <button className="btn green lg" onClick={exportCsv}>
        ⬇ Export CSV
      </button>
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
