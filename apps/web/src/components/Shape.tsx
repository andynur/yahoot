/** The Kahoot answer shapes — triangle, diamond, circle, square, then star / pentagon. */
export function Shape({ index, size = 26 }: { index: number; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 32 32",
    fill: "currentColor" as const,
  };
  switch (index % 6) {
    case 0:
      return (
        <svg {...p} aria-hidden>
          <polygon points="16,3 30,28 2,28" />
        </svg>
      );
    case 1:
      return (
        <svg {...p} aria-hidden>
          <polygon points="16,2 30,16 16,30 2,16" />
        </svg>
      );
    case 2:
      return (
        <svg {...p} aria-hidden>
          <circle cx="16" cy="16" r="14" />
        </svg>
      );
    case 3:
      return (
        <svg {...p} aria-hidden>
          <rect x="3" y="3" width="26" height="26" rx="4" />
        </svg>
      );
    case 4:
      return (
        <svg {...p} aria-hidden>
          <polygon points="16,2 20,12 31,12 22,19 25,30 16,23 7,30 10,19 1,12 12,12" />
        </svg>
      );
    default:
      return (
        <svg {...p} aria-hidden>
          <polygon points="16,2 30,12 24,29 8,29 2,12" />
        </svg>
      );
  }
}

export const SHAPE_NAMES = [
  "triangle",
  "diamond",
  "circle",
  "square",
  "star",
  "pentagon",
];
