import { expect, test, describe } from "bun:test";
import { buildRecap, type CardInput } from "./shareCard";

const base: CardInput = {
  quizTitle: "Bahasa Arab — Bab 3",
  theme: { preset: "purple" },
  questionCount: 4,
  url: "https://quiz.school.sch.id/r/abc123",
  players: [
    { nickname: "Aisyah", avatar: "🐯", score: 1997, rank: 1 },
    { nickname: "Zaid", avatar: "🐸", score: 1900, rank: 2 },
    { nickname: "Umar", avatar: "🦄", score: 1800, rank: 3 },
    { nickname: "Fatimah", avatar: "🐨", score: 1200, rank: 4 },
  ],
};

describe("buildRecap", () => {
  test("leads with the title and medals the top three", () => {
    const recap = buildRecap(base);
    expect(recap).toContain("Bahasa Arab — Bab 3");
    expect(recap).toContain("🥇 Aisyah");
    expect(recap).toContain("🥈 Zaid");
    expect(recap).toContain("🥉 Umar");
    // Fourth place is on the linked page, not in a chat message.
    expect(recap).not.toContain("Fatimah");
  });

  test("ends with the public link, so a paste always carries it", () => {
    expect(buildRecap(base).trimEnd().endsWith(base.url)).toBe(true);
  });

  test("counts every player, not just the podium", () => {
    expect(buildRecap(base)).toContain("4 players");
  });

  test("orders by rank even if the caller does not", () => {
    const shuffled = { ...base, players: [...base.players].reverse() };
    const lines = buildRecap(shuffled).split("\n");
    expect(lines[2]).toContain("Aisyah");
  });

  test("stays singular for a one-player, one-question game", () => {
    const solo: CardInput = {
      ...base,
      questionCount: 1,
      players: [base.players[0]!],
    };
    expect(buildRecap(solo)).toContain("1 player · 1 question");
  });
});
