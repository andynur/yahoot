import { useEffect, useMemo, useRef, useState } from "react";
import { AVATARS, normalizePin, type Avatar } from "@shared/wire";
import { Confetti } from "../components/Confetti";
import { Media } from "../components/Media";
import { FloatingReactions, ReactionBar } from "../components/Reactions";
import { Shape } from "../components/Shape";
import { SoundToggle } from "../components/SoundToggle";
import { Timer } from "../components/Timer";
import { useCountUp } from "../hooks";
import { sfx } from "../sound";
import { useGameSocket } from "../useGameSocket";
import { useGameSound } from "../useGameSound";
import { useQuizTheme } from "../theme";

export function Player() {
  const urlPin = useMemo(
    () => new URLSearchParams(window.location.search).get("pin") ?? "",
    [],
  );
  const [formPin, setFormPin] = useState(urlPin);
  const [formNick, setFormNick] = useState("");
  const [avatar, setAvatar] = useState<Avatar>(
    () => AVATARS[Math.floor(Math.random() * AVATARS.length)]!,
  );
  const [pin, setPin] = useState<string | null>(null);
  const pending = useRef<{ nickname: string; avatar: Avatar } | null>(null);

  const game = useGameSocket({ pin, role: "player" });

  useEffect(() => {
    if (game.connected && !game.you && pending.current) {
      game.joinAsPlayer(pending.current.nickname, pending.current.avatar);
      pending.current = null;
    }
  }, [game.connected, game.you, game]);

  useEffect(() => {
    if (game.notice?.includes("rejoin failed")) {
      game.forgetPlayer();
      setPin(null);
    }
  }, [game.notice, game]);

  if (!pin) {
    return (
      <div className="screen center">
        <h1 className="brand">Join the game</h1>
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            // The PIN is displayed grouped ("142 001") — accept it either way.
            const clean = normalizePin(formPin);
            if (!clean) return;
            // A blank nickname is fine: the server assigns one.
            pending.current = { nickname: formNick.trim(), avatar };
            setPin(clean);
          }}
        >
          <label className="label">Game PIN</label>
          <input
            className="input big"
            inputMode="numeric"
            autoComplete="off"
            placeholder="123 456"
            value={formPin}
            onChange={(e) => setFormPin(e.target.value)}
          />

          <label className="label">Pick your avatar</label>
          <div className="avatar-grid">
            {AVATARS.map((a) => (
              <button
                key={a}
                type="button"
                className={`avatar-btn${a === avatar ? " on" : ""}`}
                aria-label={`Avatar ${a}`}
                aria-pressed={a === avatar}
                onClick={() => setAvatar(a)}
              >
                {a}
              </button>
            ))}
          </div>

          <label className="label">Nickname (optional)</label>
          <input
            className="input"
            placeholder="Leave empty for a random name"
            maxLength={20}
            value={formNick}
            onChange={(e) => setFormNick(e.target.value)}
          />
          <button className="btn dark block lg" type="submit">
            Enter
          </button>
        </form>
      </div>
    );
  }

  return <PlayerGame game={game} />;
}

function PlayerGame({ game }: { game: ReturnType<typeof useGameSocket> }) {
  useGameSound(game, "player");
  useQuizTheme(game.theme);
  const q = game.question;
  const myRank = game.leaderboard.find(
    (r) => r.playerId === game.you?.playerId,
  );
  const [picked, setPicked] = useState<number | null>(null);

  // reset the remembered pick when a new question opens
  useEffect(() => {
    if (game.state === "QUESTION_ACTIVE") setPicked(null);
  }, [q?.id, game.state]);

  return (
    <div className="screen">
      <FloatingReactions items={game.reactions} />
      {game.state === "ENDED" && myRank?.rank === 1 && <Confetti count={120} />}
      <SoundToggle />

      <header className="row between">
        <span className="pill solid">
          {game.you ? `${game.you.avatar} ${game.you.nickname}` : "…"}
        </span>
        <span className="pill">
          {(game.you?.score ?? 0).toLocaleString()} pts
        </span>
      </header>

      {!game.connected && <p className="notice warn">Reconnecting…</p>}

      {game.state === "LOBBY" && (
        <div className="center grow">
          <h2 className="huge on-purple">You&apos;re in!</h2>
          <p className="tagline">
            See your name on the screen? Sit tight
            <span className="dots" />
          </p>
          <ReactionBar onReact={game.react} />
        </div>
      )}

      {game.state === "QUESTION_ACTIVE" && q && (
        <div className="grow stack">
          <div className="q-header">
            <span className="q-counter">
              {q.index + 1} / {q.total}
            </span>
            {q.kind === "true_false" && (
              <span className="kind-tag">True or False</span>
            )}
            {game.questionShownAt && (
              <Timer deadline={q.deadline} shownAt={game.questionShownAt} />
            )}
          </div>

          {game.answered ? (
            <div className="center grow">
              <h2 className="huge on-purple">Locked in!</h2>
              <p className="tagline">
                Waiting for everyone else
                <span className="dots" />
              </p>
              <ReactionBar onReact={game.react} />
            </div>
          ) : (
            <>
              <p className="q-prompt sm">{q.prompt}</p>
              <Media media={q.media} size="phone" />
              <div
                className={`controller${q.kind === "true_false" ? " tf" : ""}`}
              >
                {q.choices.map((choice, i) => (
                  <button
                    key={i}
                    className={`answer a${i}`}
                    aria-label={choice}
                    onClick={() => {
                      sfx.pick();
                      setPicked(i);
                      game.send({
                        type: "PLAYER_ANSWER",
                        questionId: q.id,
                        choiceIndex: i,
                      });
                    }}
                  >
                    <span className="shape">
                      <Shape index={i} size={64} />
                    </span>
                    {q.kind === "true_false" && (
                      <span className="tf-label">{choice}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {game.state === "ANSWERS_LOCKED" && (
        <div className="center grow">
          <h2 className="huge on-purple">Time&apos;s up!</h2>
          <p className="tagline">
            Counting the votes
            <span className="dots" />
          </p>
        </div>
      )}

      {game.state === "REVEAL" &&
        (game.myResult ? (
          <Verdict
            correct={game.myResult.correct}
            points={game.myResult.pointsAwarded}
            pickedIndex={picked}
            onReact={game.react}
          />
        ) : (
          <div className="center grow">
            <h2 className="huge on-purple">Look at the screen 👀</h2>
            <ReactionBar onReact={game.react} />
          </div>
        ))}

      {game.state === "LEADERBOARD" && (
        <div className="center grow">
          <h2 className="huge on-purple">
            {myRank ? `${ordinal(myRank.rank)} place` : "Keep going!"}
          </h2>
          <p className="big on-purple">
            {(myRank?.score ?? game.you?.score ?? 0).toLocaleString()} pts
          </p>
          <ReactionBar onReact={game.react} />
        </div>
      )}

      {game.state === "ENDED" && (
        <div className="center grow">
          <h2 className="huge on-purple">
            {myRank?.rank === 1 ? "🏆 You won!" : "Game over"}
          </h2>
          {myRank && (
            <p className="big on-purple">
              {ordinal(myRank.rank)} · {myRank.score.toLocaleString()} pts
            </p>
          )}
          <ReactionBar onReact={game.react} />
        </div>
      )}

      {game.notice &&
        game.state !== "REVEAL" &&
        game.state !== "QUESTION_ACTIVE" && (
          <p className="notice">{game.notice}</p>
        )}
    </div>
  );
}

function Verdict({
  correct,
  points,
  pickedIndex,
  onReact,
}: {
  correct: boolean;
  points: number;
  pickedIndex: number | null;
  onReact: Parameters<typeof ReactionBar>[0]["onReact"];
}) {
  const shown = useCountUp(points);
  return (
    <div className={`verdict ${correct ? "good" : "bad"}`}>
      <div className="mark">{correct ? "✓" : "✗"}</div>
      <h2 className="huge">{correct ? "Correct!" : "Incorrect"}</h2>
      {correct && <div className="pts">+{shown.toLocaleString()}</div>}
      {pickedIndex !== null && (
        <span className="pill solid">
          <Shape index={pickedIndex} size={18} /> your pick
        </span>
      )}
      <div style={{ marginTop: 20 }}>
        <ReactionBar onReact={onReact} />
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || "th"}`;
}
