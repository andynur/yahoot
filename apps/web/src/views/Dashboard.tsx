import { useEffect, useRef, useState } from "react";
import type { QuestionKind } from "@shared/protocol";
import {
  DEFAULT_THEME,
  isYouTubeUrl,
  THEME_PRESETS,
  type QuizTheme,
  type ThemePreset,
} from "@shared/wire";
import {
  api,
  blankQuestion,
  type QuestionDraft,
  type QuizDetail,
  type QuizSummary,
} from "../api";
import { Media } from "../components/Media";
import { Shape } from "../components/Shape";
import { CSV_TEMPLATE, questionsFromCsv } from "../csv";
import { downloadText } from "../download";
import { downscaleImage, formatBytes } from "../image";
import { THEME_LABEL, THEME_SWATCH, useQuizTheme } from "../theme";
import { Reports } from "./Reports";

type Editing = { mode: "new" } | { mode: "edit"; quiz: QuizDetail } | null;

export function Dashboard({
  onHost,
  onLogout,
}: {
  onHost: (pin: string, quizTitle: string) => void;
  onLogout: () => void;
}) {
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [showReports, setShowReports] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setQuizzes((await api.listQuizzes()).quizzes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load quizzes");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (showReports) {
    return <Reports onBack={() => setShowReports(false)} />;
  }

  if (editing) {
    return (
      <QuizEditor
        initial={editing.mode === "edit" ? editing.quiz : null}
        onDone={async () => {
          setEditing(null);
          await load();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="screen">
      <header className="row between">
        <h1 className="brand sm">
          <span className="k">Y</span> Dashboard
        </h1>
        <div className="row">
          <button className="link" onClick={() => setShowReports(true)}>
            Reports
          </button>
          <button className="link" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      <p className="tagline">
        Your quizzes — edit, then host one on the big screen.
      </p>
      {error && <p className="notice warn">{error}</p>}

      <div className="quiz-list">
        {quizzes?.length === 0 && (
          <p className="on-purple">
            No quizzes yet. Create your first one below.
          </p>
        )}
        {quizzes?.map((q) => (
          <div key={q.id} className="quiz-row">
            <div className="quiz-row-main">
              <strong>{q.title}</strong>
              <span className="muted">
                {q.question_count} question{q.question_count === 1 ? "" : "s"}
              </span>
            </div>
            <div className="row">
              <button
                className="btn ghost on-paper"
                disabled={busyId === q.id}
                onClick={async () => {
                  setError(null);
                  try {
                    const { quiz } = await api.getQuiz(q.id);
                    setEditing({ mode: "edit", quiz });
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "load failed",
                    );
                  }
                }}
              >
                Edit
              </button>
              <button
                className="btn green"
                disabled={busyId === q.id || q.question_count === 0}
                onClick={async () => {
                  setBusyId(q.id);
                  setError(null);
                  try {
                    const g = await api.createGame(q.id);
                    onHost(g.pin, g.quizTitle);
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "could not start",
                    );
                  } finally {
                    setBusyId(null);
                  }
                }}
              >
                Host
              </button>
              <button
                className="btn dark"
                disabled={busyId === q.id}
                onClick={async () => {
                  if (
                    !confirm(
                      `Delete "${q.title}"?\n\nPast game results for this quiz are deleted too. This cannot be undone.`,
                    )
                  )
                    return;
                  setBusyId(q.id);
                  try {
                    await api.deleteQuiz(q.id);
                    await load();
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "delete failed",
                    );
                  } finally {
                    setBusyId(null);
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn green lg"
        onClick={() => setEditing({ mode: "new" })}
      >
        + New quiz
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function QuizEditor({
  initial,
  onDone,
  onCancel,
}: {
  initial: QuizDetail | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [defaultTime, setDefaultTime] = useState(
    initial?.defaultTimeLimitSeconds ?? 20,
  );
  const [defaultPoints, setDefaultPoints] = useState(
    initial?.defaultMaxPoints ?? 1000,
  );
  const [theme, setTheme] = useState<QuizTheme>(
    initial?.theme ?? DEFAULT_THEME,
  );
  const [questions, setQuestions] = useState<QuestionDraft[]>(
    initial?.questions.length ? initial.questions : [blankQuestion()],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importNote, setImportNote] = useState<string[] | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  // The editor page wears the quiz's own backdrop, so picking a theme is its
  // own preview — no separate swatch box needed.
  useQuizTheme(theme);

  const patch = (i: number, next: QuestionDraft) =>
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? next : q)));

  const move = (i: number, dir: -1 | 1) =>
    setQuestions((qs) => {
      const j = i + dir;
      if (j < 0 || j >= qs.length) return qs;
      const copy = [...qs];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });

  const validate = (): string | null => {
    if (!title.trim()) return "Give the quiz a title.";
    if (questions.length === 0) return "Add at least one question.";
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;
      const n = i + 1;
      if (!q.prompt.trim()) return `Question ${n}: the prompt is empty.`;
      const filled = q.choices.map((c) => c.trim());
      if (q.kind === "multiple_choice" && filled.filter(Boolean).length < 2)
        return `Question ${n}: needs at least two answers.`;
      if (!filled[q.correctIndex])
        return `Question ${n}: mark which answer is correct.`;
      if (q.media.kind !== "none" && !q.media.url.trim())
        return `Question ${n}: add the ${q.media.kind} URL or remove the media.`;
    }
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);

    // drop empty trailing choices for multiple-choice questions
    const payload = {
      title: title.trim(),
      defaultTimeLimitSeconds: defaultTime,
      defaultMaxPoints: defaultPoints,
      theme,
      questions: questions.map((q) => ({
        ...q,
        prompt: q.prompt.trim(),
        choices:
          q.kind === "true_false"
            ? ["True", "False"]
            : q.choices.map((c) => c.trim()).filter(Boolean),
      })),
    };

    try {
      if (initial) await api.updateQuiz(initial.id, payload);
      else await api.createQuiz(payload);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <header className="row between">
        <h1 className="brand sm">{initial ? "Edit quiz" : "New quiz"}</h1>
        <button className="link" onClick={onCancel}>
          Cancel
        </button>
      </header>

      <input
        className="input title-input"
        placeholder="Quiz title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
      />

      <QuizSettings
        defaultTime={defaultTime}
        defaultPoints={defaultPoints}
        theme={theme}
        questionCount={questions.length}
        onTime={setDefaultTime}
        onPoints={setDefaultPoints}
        onTheme={setTheme}
        onApplyToAll={() =>
          setQuestions((qs) =>
            qs.map((q) => ({
              ...q,
              timeLimitSeconds: defaultTime,
              maxPoints: defaultPoints,
            })),
          )
        }
      />

      {questions.map((q, i) => (
        <QuestionCard
          key={i}
          index={i}
          total={questions.length}
          value={q}
          onChange={(next) => patch(i, next)}
          onRemove={() =>
            setQuestions((qs) => qs.filter((_, idx) => idx !== i))
          }
          onMove={(dir) => move(i, dir)}
        />
      ))}

      <div className="row wrap">
        <button
          className="btn ghost"
          onClick={() =>
            setQuestions((qs) => [
              ...qs,
              blankQuestion("multiple_choice", {
                timeLimitSeconds: defaultTime,
                maxPoints: defaultPoints,
              }),
            ])
          }
        >
          + Multiple choice
        </button>
        <button
          className="btn ghost"
          onClick={() =>
            setQuestions((qs) => [
              ...qs,
              blankQuestion("true_false", {
                timeLimitSeconds: defaultTime,
                maxPoints: defaultPoints,
              }),
            ])
          }
        >
          + True / False
        </button>

        <button className="btn ghost" onClick={() => csvRef.current?.click()}>
          ⬆ Import CSV
        </button>
        <button
          className="btn ghost"
          onClick={() => downloadText("quiz-template.csv", CSV_TEMPLATE)}
        >
          ⬇ CSV template
        </button>
        <input
          ref={csvRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const { questions: imported, errors } = questionsFromCsv(
              await file.text(),
              {
                timeLimitSeconds: defaultTime,
                maxPoints: defaultPoints,
              },
            );
            if (imported.length) {
              // append rather than replace — never destroy existing work
              setQuestions((qs) => {
                const blank =
                  qs.length === 1 && !qs[0]!.prompt.trim() ? [] : qs;
                return [...blank, ...imported];
              });
            }
            setImportNote([
              imported.length
                ? `Imported ${imported.length} question${imported.length === 1 ? "" : "s"}.`
                : "Nothing imported.",
              ...errors,
            ]);
          }}
        />
      </div>

      {importNote && (
        <div className="notice import-note">
          {importNote.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <button className="link" onClick={() => setImportNote(null)}>
            Dismiss
          </button>
        </div>
      )}

      {error && <p className="notice warn">{error}</p>}

      <div className="row wrap editor-actions">
        <button className="btn green lg" onClick={save} disabled={saving}>
          {saving ? "Saving…" : initial ? "Save changes" : "Create quiz"}
        </button>
        <button className="btn dark lg" onClick={onCancel} disabled={saving}>
          Discard
        </button>
      </div>
    </div>
  );
}

/**
 * Quiz-wide settings: the default question timer/points and the backdrop shown
 * on the projector. The timer here is a *default* — each question keeps its own
 * value (that's what the engine reads), so "Apply to all" is an explicit action
 * rather than a silent overwrite.
 */
function QuizSettings({
  defaultTime,
  defaultPoints,
  theme,
  questionCount,
  onTime,
  onPoints,
  onTheme,
  onApplyToAll,
}: {
  defaultTime: number;
  defaultPoints: number;
  theme: QuizTheme;
  questionCount: number;
  onTime: (n: number) => void;
  onPoints: (n: number) => void;
  onTheme: (t: QuizTheme) => void;
  onApplyToAll: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [applied, setApplied] = useState(false);

  return (
    <section className="panel quiz-settings">
      <h3 className="settings-title">Quiz settings</h3>

      <div className="row wrap q-meta">
        <label className="field">
          <span className="label">Default time (sec)</span>
          <input
            className="input sm"
            type="number"
            min={5}
            max={120}
            value={defaultTime}
            onChange={(e) => onTime(clampInt(e.target.value, 5, 120, 20))}
          />
        </label>
        <label className="field">
          <span className="label">Default points</span>
          <input
            className="input sm"
            type="number"
            min={100}
            max={5000}
            step={100}
            value={defaultPoints}
            onChange={(e) =>
              onPoints(clampInt(e.target.value, 100, 5000, 1000))
            }
          />
        </label>
        <label className="field">
          <span className="label">&nbsp;</span>
          <button
            className="btn ghost on-paper"
            type="button"
            onClick={() => {
              onApplyToAll();
              setApplied(true);
              setTimeout(() => setApplied(false), 1800);
            }}
          >
            {applied
              ? `✓ Applied to ${questionCount}`
              : `Apply to all ${questionCount} questions`}
          </button>
        </label>
      </div>

      <div className="stack sm-gap">
        <span className="label">Showcase background</span>
        <div className="theme-grid">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`theme-chip${theme.preset === preset ? " on" : ""}`}
              style={{ background: THEME_SWATCH[preset] }}
              onClick={() =>
                onTheme({ ...theme, preset: preset as ThemePreset })
              }
              aria-pressed={theme.preset === preset}
            >
              <span>{THEME_LABEL[preset]}</span>
            </button>
          ))}
        </div>

        <div className="row wrap">
          <button
            className="btn ghost on-paper"
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? "Uploading…" : "Upload background image"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setUploading(true);
              try {
                const { file: shrunk } = await downscaleImage(file, 1920);
                const { url } = await api.uploadImage(shrunk);
                onTheme({ ...theme, image: url });
              } finally {
                setUploading(false);
              }
            }}
          />
          <input
            className="input"
            placeholder="…or paste an image URL (optional)"
            value={theme.image ?? ""}
            onChange={(e) =>
              onTheme({ ...theme, image: e.target.value || undefined })
            }
          />
          {theme.image && (
            <button
              className="icon-btn danger"
              type="button"
              aria-label="Remove background image"
              onClick={() => onTheme({ preset: theme.preset })}
            >
              ✕
            </button>
          )}
        </div>

        <p className="muted theme-hint">
          The page behind this panel is showing the backdrop live — that's
          exactly what the projector will look like.
        </p>
      </div>
    </section>
  );
}

const CHOICE_COLORS = ["red", "blue", "gold", "green", "star", "plum"];

function QuestionCard({
  index,
  total,
  value,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  total: number;
  value: QuestionDraft;
  onChange: (next: QuestionDraft) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const q = value;

  const setKind = (kind: QuestionKind) => {
    if (kind === q.kind) return;
    onChange(
      kind === "true_false"
        ? { ...q, kind, choices: ["True", "False"], correctIndex: 0 }
        : {
            ...q,
            kind,
            choices: [q.choices[0] ?? "", q.choices[1] ?? "", "", ""],
            correctIndex: 0,
          },
    );
  };

  const setChoice = (i: number, text: string) =>
    onChange({
      ...q,
      choices: q.choices.map((c, idx) => (idx === i ? text : c)),
    });

  return (
    <section className="panel q-card">
      <div className="row between q-card-head">
        <span className="q-badge">Q{index + 1}</span>
        <div className="seg">
          <button
            className={q.kind === "multiple_choice" ? "on" : ""}
            onClick={() => setKind("multiple_choice")}
          >
            ABCD
          </button>
          <button
            className={q.kind === "true_false" ? "on" : ""}
            onClick={() => setKind("true_false")}
          >
            True / False
          </button>
        </div>
        <div className="row">
          <button
            className="icon-btn"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            className="icon-btn"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            className="icon-btn danger"
            disabled={total === 1}
            onClick={onRemove}
            aria-label="Delete question"
          >
            ✕
          </button>
        </div>
      </div>

      <textarea
        className="input q-prompt-input"
        placeholder="Type the question…"
        rows={2}
        maxLength={500}
        value={q.prompt}
        onChange={(e) => onChange({ ...q, prompt: e.target.value })}
      />

      <MediaEditor
        media={q.media}
        onChange={(media) => onChange({ ...q, media })}
      />

      <div className="choice-grid">
        {q.choices.map((choice, i) => {
          const disabled = q.kind === "true_false";
          return (
            <div
              key={i}
              className={`choice-row c-${CHOICE_COLORS[i]}${
                q.correctIndex === i ? " correct" : ""
              }`}
            >
              <span className="choice-shape">
                <Shape index={i} size={22} />
              </span>
              <input
                className="choice-input"
                placeholder={`Answer ${i + 1}`}
                value={choice}
                disabled={disabled}
                maxLength={200}
                onChange={(e) => setChoice(i, e.target.value)}
              />
              <label className="choice-correct" title="Correct answer">
                <input
                  type="radio"
                  name={`correct-${index}`}
                  checked={q.correctIndex === i}
                  onChange={() => onChange({ ...q, correctIndex: i })}
                />
              </label>
              {q.kind === "multiple_choice" && q.choices.length > 2 && (
                <button
                  className="icon-btn"
                  onClick={() =>
                    onChange({
                      ...q,
                      choices: q.choices.filter((_, idx) => idx !== i),
                      correctIndex:
                        q.correctIndex >= i && q.correctIndex > 0
                          ? q.correctIndex - 1
                          : q.correctIndex,
                    })
                  }
                  aria-label="Remove answer"
                >
                  −
                </button>
              )}
            </div>
          );
        })}
        {q.kind === "multiple_choice" && q.choices.length < 6 && (
          <button
            className="btn ghost on-paper add-choice"
            onClick={() => onChange({ ...q, choices: [...q.choices, ""] })}
          >
            + Add answer
          </button>
        )}
      </div>

      <div className="row wrap q-meta">
        <label className="field">
          <span className="label">Time (sec)</span>
          <input
            className="input sm"
            type="number"
            min={5}
            max={120}
            value={q.timeLimitSeconds}
            onChange={(e) =>
              onChange({
                ...q,
                timeLimitSeconds: clampInt(e.target.value, 5, 120, 20),
              })
            }
          />
        </label>
        <label className="field">
          <span className="label">Points</span>
          <input
            className="input sm"
            type="number"
            min={100}
            max={5000}
            step={100}
            value={q.maxPoints}
            onChange={(e) =>
              onChange({
                ...q,
                maxPoints: clampInt(e.target.value, 100, 5000, 1000),
              })
            }
          />
        </label>
      </div>
    </section>
  );
}

function MediaEditor({
  media,
  onChange,
}: {
  media: QuestionDraft["media"];
  onChange: (m: QuestionDraft["media"]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const url = media.kind === "none" ? "" : media.url;

  return (
    <div className="media-editor">
      <div className="seg">
        <button
          className={media.kind === "none" ? "on" : ""}
          onClick={() => onChange({ kind: "none" })}
        >
          No media
        </button>
        <button
          className={media.kind === "image" ? "on" : ""}
          onClick={() => onChange({ kind: "image", url })}
        >
          Image
        </button>
        <button
          className={media.kind === "video" ? "on" : ""}
          onClick={() => onChange({ kind: "video", url })}
        >
          YouTube
        </button>
      </div>

      {media.kind === "image" && (
        <div className="stack sm-gap">
          <div className="row wrap">
            <button
              className="btn ghost on-paper"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload image"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploading(true);
                setUploadError(null);
                try {
                  // Shrink before sending: this picture is downloaded by every
                  // student, so the saving is multiplied by the class size.
                  const { file: shrunk, originalBytes } =
                    await downscaleImage(file);
                  const { url: uploadedUrl, bytes } =
                    await api.uploadImage(shrunk);
                  onChange({ kind: "image", url: uploadedUrl });
                  // The server re-encodes too, so report what it actually
                  // stored — that is the size every student downloads.
                  setNote(
                    bytes < originalBytes
                      ? `Optimised ${formatBytes(originalBytes)} → ${formatBytes(bytes)}`
                      : null,
                  );
                } catch (err) {
                  setUploadError(
                    err instanceof Error ? err.message : "upload failed",
                  );
                } finally {
                  setUploading(false);
                }
              }}
            />
            <input
              className="input"
              placeholder="…or paste an image URL"
              value={url}
              onChange={(e) => onChange({ kind: "image", url: e.target.value })}
            />
          </div>
          {uploadError && <p className="notice warn">{uploadError}</p>}
          {note && <p className="muted upload-note">{note}</p>}
        </div>
      )}

      {media.kind === "video" && (
        <div className="stack sm-gap">
          <input
            className="input"
            placeholder="Paste a YouTube link"
            value={url}
            onChange={(e) => onChange({ kind: "video", url: e.target.value })}
          />
          {url.trim() && !isYouTubeUrl(url) && (
            <p className="notice warn">
              Only YouTube links work here — the clip plays from YouTube, not
              from this server.
            </p>
          )}
        </div>
      )}

      {media.kind !== "none" && url.trim() && (
        <div className="media-preview">
          <Media media={media} size="phone" />
        </div>
      )}
    </div>
  );
}

function clampInt(
  raw: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
