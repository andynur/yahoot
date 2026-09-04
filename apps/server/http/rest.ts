/**
 * REST routes — thin. Auth, quiz CRUD, "create game" (mints a PIN + seeds the
 * live session), and results lookup. All game *play* happens over WebSocket.
 */
import { DEFAULT_THEME } from "@shared/protocol";
import { all, db, fromJson, get, nowIso, run, tx } from "../db/db";
import { logWarn } from "../log";
import { signTeacherToken } from "../auth/jwt";
import * as engine from "../game/engine";
import type { EngineQuestion } from "../game/types";
import { generatePin } from "../pin";
import { HttpError, json, parseBody, requireTeacher, route } from "./respond";
import { CreateGameInput, Credentials, QuizInput } from "./schemas";
import type { QuestionInput } from "./schemas";
import { uploadRoutes } from "./uploads";

/** SQLite surfaces a PIN collision on the partial unique index as this error. */
function isUniqueViolation(err: unknown): boolean {
  return String((err as Error)?.message ?? "").includes("UNIQUE constraint");
}

function toEngineQuestions(rows: any[]): EngineQuestion[] {
  return rows.map((q) => ({
    id: q.id,
    kind: q.kind,
    prompt: q.prompt,
    media: fromJson(q.media, { kind: "none" as const }),
    choices: fromJson<string[]>(q.choices, []),
    correctIndex: q.correct_index,
    timeLimitSeconds: q.time_limit_seconds,
    maxPoints: q.max_points,
  }));
}

/** Insert one authored question. JSON columns are TEXT in SQLite. */
function insertQuestion(quizId: string, q: QuestionInput, position: number) {
  run(
    `insert into questions (id, quiz_id, position, kind, prompt, media, choices,
                            correct_index, time_limit_seconds, max_points)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    quizId,
    position,
    q.kind,
    q.prompt,
    JSON.stringify(q.media),
    JSON.stringify(q.choices),
    q.correctIndex,
    q.timeLimitSeconds,
    q.maxPoints,
  );
}

// --- auth ------------------------------------------------------------------

const register = route(async (req) => {
  const { email, password } = await parseBody(req, Credentials);
  if (get("select id from teachers where email = ?", email))
    throw new HttpError(409, "email already registered");

  const id = crypto.randomUUID();
  run(
    "insert into teachers (id, email, password_hash, created_at) values (?, ?, ?, ?)",
    id,
    email,
    await Bun.password.hash(password),
    nowIso(),
  );
  return json(
    { token: await signTeacherToken(id), teacher: { id, email } },
    201,
  );
});

const login = route(async (req) => {
  const { email, password } = await parseBody(req, Credentials);
  const teacher = get<{ id: string; password_hash: string }>(
    "select id, password_hash from teachers where email = ?",
    email,
  );
  if (
    !teacher ||
    !(await Bun.password.verify(password, teacher.password_hash))
  ) {
    throw new HttpError(401, "invalid email or password");
  }
  return json({
    token: await signTeacherToken(teacher.id),
    teacher: { id: teacher.id, email },
  });
});

// --- quiz CRUD ------------------------------------------------------------

const listQuizzes = route(async (req) => {
  const teacherId = await requireTeacher(req);
  const rows = all<any>(
    `select q.id, q.title, q.created_at, q.theme,
            q.default_time_limit_seconds, q.default_max_points,
            count(qs.id) as question_count
     from quizzes q
     left join questions qs on qs.quiz_id = q.id
     where q.teacher_id = ?
     group by q.id
     order by q.created_at desc`,
    teacherId,
  );
  return json({
    quizzes: rows.map((q: any) => ({
      id: q.id,
      title: q.title,
      created_at: q.created_at,
      question_count: q.question_count,
      theme: fromJson(q.theme, DEFAULT_THEME),
      defaultTimeLimitSeconds: q.default_time_limit_seconds,
      defaultMaxPoints: q.default_max_points,
    })),
  });
});

const createQuiz = route(async (req) => {
  const teacherId = await requireTeacher(req);
  const data = await parseBody(req, QuizInput);

  const id = tx(() => {
    const quizId = crypto.randomUUID();
    const now = nowIso();
    run(
      `insert into quizzes (id, teacher_id, title, default_time_limit_seconds,
                            default_max_points, theme, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      quizId,
      teacherId,
      data.title,
      data.defaultTimeLimitSeconds,
      data.defaultMaxPoints,
      JSON.stringify(data.theme),
      now,
      now,
    );
    data.questions.forEach((q, position) =>
      insertQuestion(quizId, q, position),
    );
    return quizId;
  });

  return json({ id }, 201);
});

const getQuiz = route<"/api/quizzes/:id">(async (req) => {
  const teacherId = await requireTeacher(req);
  const quiz = get<any>(
    `select id, title, created_at, theme,
            default_time_limit_seconds, default_max_points
     from quizzes where id = ? and teacher_id = ?`,
    req.params.id,
    teacherId,
  );
  if (!quiz) throw new HttpError(404, "quiz not found");

  const rows = all<any>(
    `select id, position, kind, prompt, media, choices, correct_index,
            time_limit_seconds, max_points
     from questions where quiz_id = ? order by position`,
    quiz.id,
  );
  const questions = rows.map((q: any) => ({
    id: q.id,
    position: q.position,
    kind: q.kind,
    prompt: q.prompt,
    media: fromJson(q.media, { kind: "none" as const }),
    choices: fromJson<string[]>(q.choices, []),
    correctIndex: q.correct_index,
    timeLimitSeconds: q.time_limit_seconds,
    maxPoints: q.max_points,
  }));
  return json({
    quiz: {
      id: quiz.id,
      title: quiz.title,
      created_at: quiz.created_at,
      theme: fromJson(quiz.theme, DEFAULT_THEME),
      defaultTimeLimitSeconds: quiz.default_time_limit_seconds,
      defaultMaxPoints: quiz.default_max_points,
      questions,
    },
  });
});

const updateQuiz = route<"/api/quizzes/:id">(async (req) => {
  const teacherId = await requireTeacher(req);
  const data = await parseBody(req, QuizInput);

  tx(() => {
    const owned = get<{ id: string }>(
      "select id from quizzes where id = ? and teacher_id = ?",
      req.params.id,
      teacherId,
    );
    if (!owned) throw new HttpError(404, "quiz not found");

    run(
      `update quizzes set title = ?, default_time_limit_seconds = ?,
                          default_max_points = ?, theme = ?, updated_at = ?
       where id = ?`,
      data.title,
      data.defaultTimeLimitSeconds,
      data.defaultMaxPoints,
      JSON.stringify(data.theme),
      nowIso(),
      owned.id,
    );
    run("delete from questions where quiz_id = ?", owned.id);
    data.questions.forEach((q, position) =>
      insertQuestion(owned.id, q, position),
    );
  });

  return json({ ok: true });
});

const deleteQuiz = route<"/api/quizzes/:id">(async (req) => {
  const teacherId = await requireTeacher(req);

  // Deleting cascades to this quiz's past sessions and their saved results, so
  // never pull it out from under a game that is still being played.
  const live = get<{ pin: string }>(
    "select pin from game_sessions where quiz_id = ? and status <> 'ended'",
    req.params.id,
  );
  if (live)
    throw new HttpError(
      409,
      `game ${live.pin} is still running — finish it before deleting this quiz`,
    );

  const deleted = run(
    "delete from quizzes where id = ? and teacher_id = ?",
    req.params.id,
    teacherId,
  );
  if (deleted === 0) throw new HttpError(404, "quiz not found");
  return json({ ok: true });
});

// --- games ---------------------------------------------------------------

const createGame = route(async (req) => {
  const teacherId = await requireTeacher(req);
  const { quizId } = await parseBody(req, CreateGameInput);

  const quiz = get<any>(
    "select id, title, theme from quizzes where id = ? and teacher_id = ?",
    quizId,
    teacherId,
  );
  if (!quiz) throw new HttpError(404, "quiz not found");

  const questionRows = all<any>(
    `select id, kind, prompt, media, choices, correct_index,
            time_limit_seconds, max_points
     from questions where quiz_id = ? order by position`,
    quiz.id,
  );
  if (!questionRows.length)
    throw new HttpError(422, "this quiz has no questions");

  let session: { id: string; pin: string } | undefined;
  for (let attempt = 0; attempt < 5 && !session; attempt++) {
    const pin = generatePin();
    try {
      const id = crypto.randomUUID();
      run(
        `insert into game_sessions (id, quiz_id, host_teacher_id, pin, status, created_at)
         values (?, ?, ?, ?, 'lobby', ?)`,
        id,
        quiz.id,
        teacherId,
        pin,
        nowIso(),
      );
      session = { id, pin };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  if (!session)
    throw new HttpError(503, "could not allocate a free game PIN, try again");

  await engine.createSession({
    sessionId: session.id,
    pin: session.pin,
    quizId: quiz.id,
    quizTitle: quiz.title,
    theme: fromJson(quiz.theme, DEFAULT_THEME),
    questions: toEngineQuestions(questionRows),
  });

  return json(
    {
      pin: session.pin,
      sessionId: session.id,
      quizTitle: quiz.title,
      theme: fromJson(quiz.theme, DEFAULT_THEME),
    },
    201,
  );
});

const getResults = route<"/api/games/:pin/results">(async (req) => {
  // Scoped to the hosting teacher — a bare PIN is guessable, and results carry
  // every student's name and score.
  const teacherId = await requireTeacher(req);
  const session = get<any>(
    `select id, status, ended_at, quiz_id from game_sessions
     where pin = ? and host_teacher_id = ?
     order by created_at desc limit 1`,
    req.params.pin,
    teacherId,
  );
  if (!session) throw new HttpError(404, "no game with that PIN");

  const results = all<any>(
    `select player_id, nickname, final_score, final_rank, correct_count, answers
     from game_results where session_id = ? order by final_rank`,
    session.id,
  );
  return json({ status: session.status, endedAt: session.ended_at, results });
});

// --- reports ---------------------------------------------------------------

/** Past sessions this teacher hosted, newest first. */
const listSessions = route(async (req) => {
  const teacherId = await requireTeacher(req);
  const rows = all<any>(
    `select gs.id, gs.pin, gs.status, gs.created_at, gs.ended_at,
            q.title as quiz_title,
            count(gr.id) as player_count,
            coalesce(max(gr.final_score), 0) as top_score
     from game_sessions gs
     join quizzes q on q.id = gs.quiz_id
     left join game_results gr on gr.session_id = gs.id
     where gs.host_teacher_id = ?
     group by gs.id, q.title
     order by gs.created_at desc
     limit 100`,
    teacherId,
  );
  return json({
    sessions: rows.map((r: any) => ({
      id: r.id,
      pin: r.pin,
      status: r.status,
      quizTitle: r.quiz_title,
      createdAt: r.created_at,
      endedAt: r.ended_at,
      playerCount: r.player_count,
      topScore: r.top_score,
    })),
  });
});

interface LoggedAnswer {
  questionId: string;
  choiceIndex: number;
  correct: boolean;
  points: number;
}

/**
 * Full report for one session: final standings plus per-question difficulty.
 *
 * Stats are aggregated from each player's stored answer log rather than a
 * separate table — that log is written once at game end, so no extra
 * bookkeeping happens during play.
 */
const getSessionReport = route<"/api/sessions/:id/report">(async (req) => {
  const teacherId = await requireTeacher(req);

  const session = get<any>(
    `select gs.id, gs.pin, gs.status, gs.created_at, gs.ended_at, gs.quiz_id,
            q.title as quiz_title
     from game_sessions gs
     join quizzes q on q.id = gs.quiz_id
     where gs.id = ? and gs.host_teacher_id = ?`,
    req.params.id,
    teacherId,
  );
  if (!session) throw new HttpError(404, "session not found");

  const results = all<any>(
    `select player_id, nickname, final_score, final_rank, correct_count, answers
     from game_results where session_id = ? order by final_rank`,
    session.id,
  );

  // Prompts for whatever questions still exist on the quiz.
  const questionRows = all<any>(
    `select id, position, prompt, kind, correct_index
     from questions where quiz_id = ? order by position`,
    session.quiz_id,
  );
  const promptById = new Map<string, any>(
    questionRows.map((q: any) => [q.id, q]),
  );

  // questionId -> tallies, in the order the questions were actually played
  const order: string[] = [];
  const stats = new Map<
    string,
    { answered: number; correct: number; totalPoints: number }
  >();

  for (const row of results) {
    const log = fromJson<LoggedAnswer[]>(row.answers, []);
    for (const a of log) {
      if (!stats.has(a.questionId)) {
        stats.set(a.questionId, { answered: 0, correct: 0, totalPoints: 0 });
        order.push(a.questionId);
      }
      const s = stats.get(a.questionId)!;
      s.answered++;
      if (a.correct) s.correct++;
      s.totalPoints += a.points;
    }
  }

  const questions = order.map((id, i) => {
    const s = stats.get(id)!;
    const q = promptById.get(id);
    return {
      questionId: id,
      index: i,
      // the quiz may have been edited since — fall back rather than 404
      prompt: q?.prompt ?? `Question ${i + 1} (since edited or removed)`,
      kind: q?.kind ?? null,
      answered: s.answered,
      correct: s.correct,
      correctPct: s.answered ? Math.round((s.correct / s.answered) * 100) : 0,
      averagePoints: s.answered ? Math.round(s.totalPoints / s.answered) : 0,
    };
  });

  return json({
    session: {
      id: session.id,
      pin: session.pin,
      status: session.status,
      quizTitle: session.quiz_title,
      createdAt: session.created_at,
      endedAt: session.ended_at,
    },
    results: results.map((r: any) => ({
      playerId: r.player_id,
      nickname: r.nickname,
      score: r.final_score,
      rank: r.final_rank,
      correctCount: r.correct_count,
    })),
    questions,
  });
});

// --- health ----------------------------------------------------------------

/**
 * Real dependency probe — an uptime check that always returns ok is worse than
 * none. Returns 503 if the SQLite file is unreadable, so a monitor can see it.
 */
const health = route(async () => {
  const probe = async (name: string, fn: () => Promise<unknown>) => {
    const started = performance.now();
    try {
      await fn();
      return { name, ok: true, ms: Math.round(performance.now() - started) };
    } catch (err) {
      return {
        name,
        ok: false,
        ms: Math.round(performance.now() - started),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const checks = await Promise.all([
    probe("sqlite", async () => get("select 1 as ok")),
  ]);

  const ok = checks.every((c) => c.ok);
  if (!ok) logWarn("health_degraded", { checks });

  return json(
    { ok, uptimeSeconds: Math.round(process.uptime()), checks },
    ok ? 200 : 503,
  );
});

// --- routes map --------------------------------------------------------------

export function makeRoutes() {
  return {
    "/api/health": { GET: health },
    "/api/auth/register": { POST: register },
    "/api/auth/login": { POST: login },
    "/api/quizzes": { GET: listQuizzes, POST: createQuiz },
    "/api/quizzes/:id": { GET: getQuiz, PUT: updateQuiz, DELETE: deleteQuiz },
    "/api/games": { POST: createGame },
    "/api/games/:pin/results": { GET: getResults },
    "/api/sessions": { GET: listSessions },
    "/api/sessions/:id/report": { GET: getSessionReport },
    ...uploadRoutes,
  };
}
