import { expect, test, describe } from "bun:test";
import { computeScore } from "./scoring";

const base = { askedAt: 0, deadline: 20_000, maxPoints: 1000 };

describe("computeScore", () => {
  test("wrong answer scores zero regardless of speed", () => {
    expect(computeScore({ ...base, correct: false, answeredAt: 1 })).toBe(0);
  });

  test("instant correct answer scores full points", () => {
    expect(computeScore({ ...base, correct: true, answeredAt: 0 })).toBe(1000);
  });

  test("correct answer at the halfway point scores 75%", () => {
    expect(computeScore({ ...base, correct: true, answeredAt: 10_000 })).toBe(
      750,
    );
  });

  test("correct answer just before the deadline scores about half", () => {
    const score = computeScore({ ...base, correct: true, answeredAt: 19_999 });
    expect(score).toBeGreaterThanOrEqual(500);
    expect(score).toBeLessThanOrEqual(505);
  });

  test("answer at or after the deadline scores zero", () => {
    expect(computeScore({ ...base, correct: true, answeredAt: 20_000 })).toBe(
      0,
    );
    expect(computeScore({ ...base, correct: true, answeredAt: 25_000 })).toBe(
      0,
    );
  });

  test("clock skew before askedAt is clamped to instant", () => {
    expect(computeScore({ ...base, correct: true, answeredAt: -500 })).toBe(
      1000,
    );
  });
});
