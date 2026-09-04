import { expect, test, describe } from "bun:test";
import { transition, isLastQuestion, type GameState } from "./machine";

const ctx = (questionIndex: number, totalQuestions = 3) => ({
  questionIndex,
  totalQuestions,
});

describe("game state machine", () => {
  test("host starts the first question from the lobby", () => {
    expect(transition("LOBBY", "HOST_START_QUESTION", ctx(-1))).toEqual({
      state: "QUESTION_ACTIVE",
      questionIndex: 0,
    });
  });

  test("a lobby with no questions cannot start", () => {
    expect(transition("LOBBY", "HOST_START_QUESTION", ctx(-1, 0))).toBeNull();
  });

  test("illegal events return null instead of moving", () => {
    expect(transition("LOBBY", "HOST_NEXT", ctx(-1))).toBeNull();
    expect(transition("QUESTION_ACTIVE", "HOST_NEXT", ctx(0))).toBeNull();
    expect(transition("ENDED", "HOST_START_QUESTION", ctx(2))).toBeNull();
  });

  test("a question locks then reveals then shows the leaderboard", () => {
    expect(transition("QUESTION_ACTIVE", "LOCK", ctx(0))?.state).toBe(
      "ANSWERS_LOCKED",
    );
    expect(transition("ANSWERS_LOCKED", "SCORED", ctx(0))?.state).toBe(
      "REVEAL",
    );
    expect(transition("REVEAL", "HOST_NEXT", ctx(0))?.state).toBe(
      "LEADERBOARD",
    );
  });

  test("from the leaderboard the host advances to the next question", () => {
    expect(transition("LEADERBOARD", "HOST_START_QUESTION", ctx(0))).toEqual({
      state: "QUESTION_ACTIVE",
      questionIndex: 1,
    });
  });

  test("the last question's leaderboard cannot advance — only end", () => {
    expect(transition("LEADERBOARD", "HOST_START_QUESTION", ctx(2))).toBeNull();
    expect(transition("LEADERBOARD", "HOST_NEXT", ctx(2))?.state).toBe("ENDED");
    expect(isLastQuestion(ctx(2))).toBe(true);
    expect(isLastQuestion(ctx(1))).toBe(false);
  });

  test("a full two-question game runs start to finish", () => {
    let state = "LOBBY" as GameState;
    let index = -1;
    const total = 2;
    const step = (event: Parameters<typeof transition>[1]) => {
      const next = transition(state, event, {
        questionIndex: index,
        totalQuestions: total,
      });
      if (!next) throw new Error(`illegal ${event} from ${state}`);
      state = next.state;
      index = next.questionIndex;
    };

    step("HOST_START_QUESTION"); // Q0
    step("LOCK");
    step("SCORED");
    step("HOST_NEXT"); // leaderboard
    step("HOST_START_QUESTION"); // Q1
    step("LOCK");
    step("SCORED");
    step("HOST_NEXT"); // leaderboard
    step("HOST_NEXT"); // ended

    expect(state).toBe("ENDED");
    expect(index).toBe(1);
  });
});
