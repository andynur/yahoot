import type { CSSProperties } from "react";
import { REACTIONS, type ReactionEmoji } from "@shared/wire";

export interface FloatingReaction {
  id: number;
  emoji: string;
  from: string;
  left: number;
  duration: number;
  drift: number;
}

/** Tap-to-throw emoji row. */
export function ReactionBar({
  onReact,
}: {
  onReact: (emoji: ReactionEmoji) => void;
}) {
  return (
    <div className="reaction-bar">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="reaction-btn"
          onClick={() => onReact(emoji)}
          aria-label={`Send ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** Full-bleed layer of emoji drifting up the screen. */
export function FloatingReactions({ items }: { items: FloatingReaction[] }) {
  return (
    <div className="floating-layer" aria-hidden>
      {items.map((r) => (
        <span
          key={r.id}
          className="floating-emoji"
          style={
            {
              left: `${r.left}%`,
              animationDuration: `${r.duration}s`,
              "--drift": `${r.drift}px`,
            } as CSSProperties
          }
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
