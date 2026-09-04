import type { QuestionDraft } from "./api";

/**
 * CSV import for the quiz editor.
 *
 * Typing twenty questions into a form is miserable; pasting from a spreadsheet
 * is not. Parsing happens entirely in the browser — the rows become ordinary
 * QuestionDrafts and go through the same validation and save path as
 * hand-entered ones, so there is no second way into the database.
 */

export const CSV_HEADERS = [
  "prompt",
  "type",
  "answer1",
  "answer2",
  "answer3",
  "answer4",
  "correct",
  "seconds",
  "points",
] as const;

export const CSV_TEMPLATE = `prompt,type,answer1,answer2,answer3,answer4,correct,seconds,points
"What is the capital of Australia?",abcd,Sydney,Canberra,Melbourne,Perth,2,20,1000
"Bun is the runtime used here.",truefalse,,,,,True,15,1000
"Which planet is known as the ""Red Planet""?",abcd,Venus,Jupiter,Mars,Mercury,3,15,1000
`;

/**
 * RFC 4180-ish parser: handles quoted fields containing commas, newlines and
 * doubled quotes (`""`). A naive `split(",")` mangles every real spreadsheet
 * export, which is exactly the data teachers will paste.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // strip a UTF-8 BOM — Excel adds one
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // ignore blank trailing lines
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows;
}

export interface CsvImportResult {
  questions: QuestionDraft[];
  errors: string[];
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/** Accepts 1-based numbers ("2"), letters ("B"), or the literal answer text. */
function resolveCorrect(raw: string, choices: string[]): number | null {
  const value = raw.trim();
  if (!value) return null;

  const asNumber = Number(value);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= choices.length)
    return asNumber - 1;

  if (/^[a-f]$/i.test(value)) {
    const idx = value.toUpperCase().charCodeAt(0) - 65;
    if (idx < choices.length) return idx;
  }

  const byText = choices.findIndex(
    (c) => c.toLowerCase() === value.toLowerCase(),
  );
  return byText >= 0 ? byText : null;
}

/**
 * Turn CSV text into question drafts. Bad rows are reported rather than
 * silently dropped — a teacher needs to know row 7 was skipped and why.
 */
export function questionsFromCsv(
  text: string,
  defaults: { timeLimitSeconds: number; maxPoints: number },
): CsvImportResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  const questions: QuestionDraft[] = [];

  if (rows.length === 0) return { questions, errors: ["The file is empty."] };

  // A header row is optional — detect it so plain data still imports.
  const first = rows[0]!.map((c) => c.trim().toLowerCase());
  const hasHeader = first[0] === "prompt";
  const body = hasHeader ? rows.slice(1) : rows;

  body.forEach((cells, idx) => {
    const line = idx + (hasHeader ? 2 : 1);
    const get = (n: number) => (cells[n] ?? "").trim();

    const prompt = get(0);
    if (!prompt) {
      errors.push(`Row ${line}: no question text — skipped.`);
      return;
    }

    const typeRaw = get(1)
      .toLowerCase()
      .replace(/[\s_-]/g, "");
    const isTrueFalse =
      typeRaw === "truefalse" || typeRaw === "tf" || typeRaw === "boolean";

    const choices = isTrueFalse
      ? ["True", "False"]
      : [get(2), get(3), get(4), get(5)].filter(Boolean);

    if (!isTrueFalse && choices.length < 2) {
      errors.push(`Row ${line}: needs at least two answers — skipped.`);
      return;
    }

    const correctIndex = resolveCorrect(get(6), choices);
    if (correctIndex === null) {
      errors.push(
        `Row ${line}: "correct" must be a number, a letter, or match one of the answers — skipped.`,
      );
      return;
    }

    const seconds = Number(get(7));
    const points = Number(get(8));

    questions.push({
      kind: isTrueFalse ? "true_false" : "multiple_choice",
      prompt,
      media: { kind: "none" },
      choices,
      correctIndex,
      timeLimitSeconds:
        Number.isFinite(seconds) && seconds > 0
          ? clamp(Math.round(seconds), 5, 120)
          : defaults.timeLimitSeconds,
      maxPoints:
        Number.isFinite(points) && points > 0
          ? clamp(Math.round(points), 100, 5000)
          : defaults.maxPoints,
    });
  });

  if (questions.length === 0 && errors.length === 0)
    errors.push("No questions found in the file.");

  return { questions, errors };
}
