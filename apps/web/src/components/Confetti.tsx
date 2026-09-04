import { useEffect, useRef } from "react";
import { sfx } from "../sound";

/** Kahoot answer palette — the confetti matches the game's colours. */
const COLORS = [
  "#e21b3c",
  "#1368ce",
  "#d89e00",
  "#26890c",
  "#7d2ee6",
  "#e2138b",
  "#ffffff",
];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  spin: number;
  angle: number;
}

/**
 * A one-shot confetti burst on a canvas.
 *
 * Deliberately hand-rolled rather than a library: it's ~60 lines, adds no
 * dependency, and stops its own rAF loop once the last piece leaves the screen
 * so it never burns CPU on an idle podium screen.
 *
 * Honours `prefers-reduced-motion` — renders nothing at all for viewers who
 * asked for less movement.
 */
export function Confetti({
  count = 160,
  durationMs = 5000,
}: {
  count?: number;
  durationMs?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) return;

    const canvas = ref.current;
    const gtx = canvas?.getContext("2d");
    if (!canvas || !gtx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      gtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Two side cannons, like a stage burst.
    const pieces: Piece[] = Array.from({ length: count }, (_, i) => {
      const fromLeft = i % 2 === 0;
      return {
        x: fromLeft ? -10 : w + 10,
        y: h * (0.55 + Math.random() * 0.35),
        vx: (fromLeft ? 1 : -1) * (5 + Math.random() * 7),
        vy: -(7 + Math.random() * 7),
        size: 5 + Math.random() * 7,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        spin: (Math.random() - 0.5) * 0.3,
        angle: Math.random() * Math.PI,
      };
    });

    sfx.pop();

    const started = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const elapsed = now - started;
      gtx.clearRect(0, 0, w, h);

      let alive = 0;
      for (const p of pieces) {
        p.vy += 0.22; // gravity
        p.vx *= 0.99; // drag
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;

        if (p.y - p.size > h) continue;
        alive++;

        // fade out over the last second
        const fade = Math.max(0, Math.min(1, (durationMs - elapsed) / 1000));
        gtx.save();
        gtx.globalAlpha = fade;
        gtx.translate(p.x, p.y);
        gtx.rotate(p.angle);
        gtx.fillStyle = p.color;
        gtx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        gtx.restore();
      }

      if (alive > 0 && elapsed < durationMs) {
        raf = requestAnimationFrame(frame);
      } else {
        gtx.clearRect(0, 0, w, h);
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [count, durationMs]);

  return <canvas ref={ref} className="confetti" aria-hidden />;
}
