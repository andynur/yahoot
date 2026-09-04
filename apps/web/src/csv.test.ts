import { describe, expect, test } from "bun:test";
import { CSV_TEMPLATE, parseCsv, questionsFromCsv } from "./csv";

const defaults = { timeLimitSeconds: 20, maxPoints: 1000 };

describe("parseCsv", () => {
  test("splits plain rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("keeps commas inside quoted fields", () => {
    expect(parseCsv('"Paris, France",x')).toEqual([["Paris, France", "x"]]);
  });

  test("unescapes doubled quotes", () => {
    expect(parseCsv('"He said ""hi""",y')).toEqual([['He said "hi"', "y"]]);
  });

  test("keeps newlines inside quoted fields", () => {
    expect(parseCsv('"line one\nline two",z')).toEqual([
      ["line one\nline two", "z"],
    ]);
  });

  test("handles CRLF and drops blank lines", () => {
    expect(parseCsv("a,b\r\n\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("strips a UTF-8 BOM", () => {
    expect(parseCsv("﻿prompt,type")[0]?.[0]).toBe("prompt");
  });
});

describe("questionsFromCsv", () => {
  test("imports the shipped template cleanly", () => {
    const { questions, errors } = questionsFromCsv(CSV_TEMPLATE, defaults);
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(3);
    expect(questions[0]?.prompt).toBe("What is the capital of Australia?");
    // "2" is 1-based in the file, 0-based in the model
    expect(questions[0]?.correctIndex).toBe(1);
    expect(questions[0]?.choices).toEqual([
      "Sydney",
      "Canberra",
      "Melbourne",
      "Perth",
    ]);
  });

  test("true/false rows get exactly two choices", () => {
    const { questions } = questionsFromCsv(CSV_TEMPLATE, defaults);
    const tf = questions[1]!;
    expect(tf.kind).toBe("true_false");
    expect(tf.choices).toEqual(["True", "False"]);
    expect(tf.correctIndex).toBe(0); // matched by answer text "True"
  });

  test("preserves an escaped quote in the prompt", () => {
    const { questions } = questionsFromCsv(CSV_TEMPLATE, defaults);
    expect(questions[2]?.prompt).toBe(
      'Which planet is known as the "Red Planet"?',
    );
  });

  test("accepts a letter for the correct answer", () => {
    const { questions } = questionsFromCsv("Q?,abcd,a,b,c,d,C,,", defaults);
    expect(questions[0]?.correctIndex).toBe(2);
  });

  test("works without a header row", () => {
    const { questions, errors } = questionsFromCsv(
      "Q?,abcd,a,b,,,1,,",
      defaults,
    );
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(1);
  });

  test("falls back to the quiz defaults for blank time/points", () => {
    const { questions } = questionsFromCsv("Q?,abcd,a,b,,,1,,", defaults);
    expect(questions[0]?.timeLimitSeconds).toBe(20);
    expect(questions[0]?.maxPoints).toBe(1000);
  });

  test("clamps out-of-range time and points", () => {
    const { questions } = questionsFromCsv(
      "Q?,abcd,a,b,,,1,999,99999",
      defaults,
    );
    expect(questions[0]?.timeLimitSeconds).toBe(120);
    expect(questions[0]?.maxPoints).toBe(5000);
  });

  test("reports bad rows instead of dropping them silently", () => {
    const csv = [
      "prompt,type,answer1,answer2,answer3,answer4,correct,seconds,points",
      ",abcd,a,b,,,1,,", // no prompt
      "Only one answer?,abcd,a,,,,1,,", // too few choices
      "Bad index?,abcd,a,b,,,9,,", // correct out of range
      "Good one?,abcd,a,b,,,2,,",
    ].join("\n");

    const { questions, errors } = questionsFromCsv(csv, defaults);
    expect(questions).toHaveLength(1);
    expect(errors).toHaveLength(3);
    // row numbers account for the header line
    expect(errors[0]).toContain("Row 2");
    expect(errors[2]).toContain("Row 4");
  });

  test("an empty file is an error, not an empty import", () => {
    expect(questionsFromCsv("", defaults).errors.length).toBeGreaterThan(0);
  });
});
