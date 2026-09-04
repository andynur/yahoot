import { useEffect, useState } from "react";

/** Cosmetic circular countdown. The server's `deadline` is the real clock. */
export function Timer({
  deadline,
  shownAt,
}: {
  deadline: number;
  shownAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const total = Math.max(1, deadline - shownAt);
  const left = Math.max(0, deadline - now);
  const seconds = Math.ceil(left / 1000);
  const deg = Math.max(0, Math.min(1, left / total)) * 360;
  const urgent = left <= 5000;

  return (
    <div
      className={`timer-ring${urgent ? " urgent" : ""}`}
      style={{
        background: `conic-gradient(currentColor ${deg}deg, rgba(0,0,0,0.18) ${deg}deg)`,
      }}
      role="timer"
      aria-label={`${seconds} seconds left`}
    >
      <span>{seconds}</span>
    </div>
  );
}
