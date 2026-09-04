import { useState } from "react";
import { isSoundOn, setSoundOn, unlock } from "../sound";

/** Fixed speaker button — the mute control for the whole app. */
export function SoundToggle() {
  const [on, setOn] = useState(isSoundOn);

  return (
    <button
      type="button"
      className="sound-toggle"
      aria-pressed={on}
      aria-label={on ? "Turn sound off" : "Turn sound on"}
      title={on ? "Sound on" : "Sound off"}
      onClick={() => {
        const next = !on;
        setSoundOn(next);
        setOn(next);
        if (next) unlock(); // this click is the gesture that starts audio
      }}
    >
      {on ? "🔊" : "🔇"}
    </button>
  );
}
