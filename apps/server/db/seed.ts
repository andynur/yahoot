/**
 * Dev seed: one teacher + one demo quiz so you can host a game immediately.
 *
 *   bun run db:seed
 *
 * Login: demo@example.com / demo1234
 */
import { get, nowIso, run, tx } from "./db";
import { migrate } from "./migrate";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo1234";

const QUIZ = {
  title: "Demo Quiz — General Knowledge",
  defaultTimeLimitSeconds: 20,
  defaultMaxPoints: 1000,
  theme: { preset: "midnight" },
  questions: [
    {
      kind: "multiple_choice",
      prompt: "What is the capital of Australia?",
      media: { kind: "none" },
      choices: ["Sydney", "Canberra", "Melbourne", "Perth"],
      correct_index: 1,
      time_limit_seconds: 20,
      max_points: 1000,
    },
    {
      kind: "true_false",
      prompt:
        "The Great Wall of China is visible from the Moon with the naked eye.",
      media: { kind: "none" },
      choices: ["True", "False"],
      correct_index: 1,
      time_limit_seconds: 15,
      max_points: 1000,
    },
    {
      kind: "multiple_choice",
      prompt: "Which planet is this?",
      media: {
        kind: "image",
        url: "https://upload.wikimedia.org/wikipedia/commons/0/02/OSIRIS_Mars_true_color.jpg",
      },
      choices: ["Venus", "Jupiter", "Mars", "Mercury"],
      correct_index: 2,
      time_limit_seconds: 15,
      max_points: 1000,
    },
    {
      kind: "multiple_choice",
      prompt: "Watch the clip — which language runs this whole app?",
      media: {
        kind: "video",
        url: "https://www.youtube.com/watch?v=BsnCpESUEqM",
      },
      choices: ["Node", "Deno", "Bun", "Python"],
      correct_index: 2,
      time_limit_seconds: 20,
      max_points: 1000,
    },
  ],
};

await migrate(false);

const password_hash = await Bun.password.hash(DEMO_PASSWORD);
const now = nowIso();

const teacherId = tx(() => {
  const existing = get<{ id: string }>(
    "select id from teachers where email = ?",
    DEMO_EMAIL,
  );
  if (existing) {
    run(
      "update teachers set password_hash = ? where id = ?",
      password_hash,
      existing.id,
    );
    return existing.id;
  }
  const id = crypto.randomUUID();
  run(
    "insert into teachers (id, email, password_hash, created_at) values (?, ?, ?, ?)",
    id,
    DEMO_EMAIL,
    password_hash,
    now,
  );
  return id;
});

const quizId = tx(() => {
  // Reuse the demo quiz row if it exists: past game_sessions reference it, and
  // deleting it would take their results with it.
  const existing = get<{ id: string }>(
    "select id from quizzes where teacher_id = ? and title = ?",
    teacherId,
    QUIZ.title,
  );
  const id = existing?.id ?? crypto.randomUUID();

  if (existing) {
    run(
      `update quizzes set default_time_limit_seconds = ?, default_max_points = ?,
                          theme = ?, updated_at = ? where id = ?`,
      QUIZ.defaultTimeLimitSeconds,
      QUIZ.defaultMaxPoints,
      JSON.stringify(QUIZ.theme),
      now,
      id,
    );
  } else {
    run(
      `insert into quizzes (id, teacher_id, title, default_time_limit_seconds,
                            default_max_points, theme, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      teacherId,
      QUIZ.title,
      QUIZ.defaultTimeLimitSeconds,
      QUIZ.defaultMaxPoints,
      JSON.stringify(QUIZ.theme),
      now,
      now,
    );
  }

  run("delete from questions where quiz_id = ?", id);
  QUIZ.questions.forEach((q, position) => {
    run(
      `insert into questions (id, quiz_id, position, kind, prompt, media, choices,
                              correct_index, time_limit_seconds, max_points)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      id,
      position,
      q.kind,
      q.prompt,
      JSON.stringify(q.media),
      JSON.stringify(q.choices),
      q.correct_index,
      q.time_limit_seconds,
      q.max_points,
    );
  });
  return id;
});

console.log(
  `seeded teacher ${DEMO_EMAIL} and quiz "${QUIZ.title}" (${quizId})`,
);
