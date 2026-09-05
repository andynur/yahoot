import { useState } from "react";
import { api, getToken, setToken } from "../api";
import { Confetti } from "../components/Confetti";
import { Leaderboard } from "../components/Leaderboard";
import { Media } from "../components/Media";
import { Podium } from "../components/Podium";
import { ShareResult } from "../components/ShareResult";
import { FloatingReactions } from "../components/Reactions";
import { Shape, SHAPE_NAMES } from "../components/Shape";
import { SoundToggle } from "../components/SoundToggle";
import { Timer } from "../components/Timer";
import { useGameSocket } from "../useGameSocket";
import { useGameSound } from "../useGameSound";
import { useQuizTheme } from "../theme";
import { Dashboard } from "./Dashboard";

/** Answer colours, index-aligned with the shapes. */
const COLORS = ["red", "blue", "gold", "green", "star", "plum"];

export function Host() {
  const [token, setTok] = useState<string | null>(getToken());
  const [game, setGame] = useState<{ pin: string; quizTitle: string } | null>(
    null,
  );

  if (!token) {
    return (
      <AuthForm
        onAuthed={(t) => {
          setToken(t);
          setTok(t);
        }}
      />
    );
  }

  if (!game) {
    return (
      <Dashboard
        onHost={(pin, quizTitle) => setGame({ pin, quizTitle })}
        onLogout={() => {
          setToken(null);
          setTok(null);
        }}
      />
    );
  }

  return (
    <HostGame
      pin={game.pin}
      quizTitle={game.quizTitle}
      token={token}
      onExit={() => setGame(null)}
    />
  );
}

function AuthForm({ onAuthed }: { onAuthed: (token: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("demo@example.com");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="screen center">
      <h1 className="brand">Teacher sign in</h1>
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res =
              mode === "login"
                ? await api.login(email, password)
                : await api.register(email, password);
            onAuthed(res.token);
          } catch (err) {
            setError(err instanceof Error ? err.message : "failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="label">Email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="label">Password</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="notice warn">{error}</p>}
        <button className="btn dark block lg" type="submit" disabled={busy}>
          {mode === "login" ? "Sign in" : "Create account"}
        </button>
        <button
          type="button"
          className="btn ghost on-paper block"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login"
            ? "Need an account? Register"
            : "Have an account? Sign in"}
        </button>
      </form>
      <p className="on-purple">
        Demo login works after <code>bun run db:seed</code>
      </p>
    </div>
  );
}

function HostGame({
  pin,
  quizTitle,
  token,
  onExit,
}: {
  pin: string;
  quizTitle: string;
  token: string;
  onExit: () => void;
}) {
  const game = useGameSocket({ pin, role: "host", token });
  useGameSound(game, "host");
  useQuizTheme(game.theme);
  const q = game.question;
  const joinHost = `${window.location.host}/play`;
  const isLast = q ? q.index + 1 >= q.total : false;
  const tf = q?.kind === "true_false";

  return (
    <div className="screen">
      <FloatingReactions items={game.reactions} />
      {game.state === "ENDED" && <Confetti />}
      <SoundToggle />

      <header className="row between">
        <strong className="on-purple">{quizTitle}</strong>
        {!game.connected && <span className="pill warn">reconnecting…</span>}
      </header>

      {game.state === "LOBBY" && (
        <div className="center grow stack">
          <div className="join-bar">
            Join at <strong>{joinHost}</strong>
          </div>
          <div className="pin-box">
            <div className="k-label">Game PIN</div>
            <div className="k-pin">{formatPin(pin)}</div>
          </div>
          <span className="pill">👥 {game.playerCount} players</span>
          <div className="chips">
            {game.players.map((p) => (
              <span key={p.playerId} className="name-chip">
                <span className="avatar-chip">{p.avatar}</span>
                {p.nickname}
              </span>
            ))}
          </div>
          <button
            className="btn green lg"
            disabled={game.playerCount === 0}
            onClick={() => game.send({ type: "HOST_START_QUESTION", pin })}
          >
            Start
          </button>
        </div>
      )}

      {game.state === "QUESTION_ACTIVE" && q && (
        <div className="grow stack">
          <div className="q-header">
            <span className="q-counter">
              {q.index + 1} / {q.total}
            </span>
            {tf && <span className="kind-tag">True or False</span>}
            {game.questionShownAt && (
              <Timer deadline={q.deadline} shownAt={game.questionShownAt} />
            )}
          </div>
          <p className="q-prompt">{q.prompt}</p>
          <Media media={q.media} />
          <span className="answer-count">{game.answerCount} answered</span>
          <div className={`answers${tf ? " tf" : ""}`}>
            {q.choices.map((choice, i) => (
              <div key={i} className={`answer a${i}`}>
                <span className="shape">
                  <Shape index={i} />
                </span>
                {choice}
              </div>
            ))}
          </div>
        </div>
      )}

      {game.state === "REVEAL" && game.reveal && q && (
        <div className="grow stack">
          <p className="q-prompt">{q.prompt}</p>
          <div className="tally">
            {q.choices.map((choice, i) => {
              const count = game.reveal!.tally[i] ?? 0;
              const max = Math.max(1, ...game.reveal!.tally);
              const correct = i === game.reveal!.correctIndex;
              return (
                <div
                  key={i}
                  className={`tally-col${correct ? " correct" : ""}`}
                >
                  <div className="cap">
                    {count}
                    {correct ? " ✓" : ""}
                  </div>
                  <div
                    className="tally-bar"
                    style={{
                      height: `${20 + (count / max) * 170}px`,
                      background: `var(--${COLORS[i]})`,
                    }}
                  />
                  <div
                    className={`shape-badge a${i}`}
                    style={{ background: `var(--${COLORS[i]})` }}
                    title={SHAPE_NAMES[i]}
                  >
                    <Shape index={i} size={20} />
                  </div>
                  <div className="tally-label">{choice}</div>
                </div>
              );
            })}
          </div>
          <button
            className="btn green lg"
            onClick={() => game.send({ type: "HOST_NEXT", pin })}
          >
            Scoreboard →
          </button>
        </div>
      )}

      {game.state === "LEADERBOARD" && (
        <div className="grow stack center">
          <h2 className="huge on-purple">Scoreboard</h2>
          <Leaderboard rows={game.leaderboard} limit={5} />
          <div className="row wrap" style={{ justifyContent: "center" }}>
            {!isLast && (
              <button
                className="btn green lg"
                onClick={() => game.send({ type: "HOST_START_QUESTION", pin })}
              >
                Next question →
              </button>
            )}
            <button
              className="btn ghost lg"
              onClick={() => game.send({ type: "HOST_NEXT", pin })}
            >
              {isLast ? "Finish game" : "End now"}
            </button>
          </div>
        </div>
      )}

      {game.state === "ENDED" && (
        <div className="grow stack center">
          <h2 className="huge on-purple pop-in">🎉 Podium</h2>
          <Podium rows={game.leaderboard} />
          <p className="on-purple">Results saved.</p>
          <ShareResult pin={pin} />
          <button className="btn ghost lg" onClick={onExit}>
            Back to dashboard
          </button>
        </div>
      )}
    </div>
  );
}

function formatPin(pin: string): string {
  return pin.length === 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin;
}
