/**
 * Burst load test — the thundering herd of a real classroom.
 *
 *   bun scripts/loadtest.ts                      # 120 clients, localhost
 *   CLIENTS=150 bun scripts/loadtest.ts
 *   JITTER_MS=500 CLIENTS=200 bun scripts/loadtest.ts
 *   TARGET=wss://quiz.example.com bun scripts/loadtest.ts   # against a deploy
 *
 * Three tabs tell you nothing about 100 phones answering in the same two
 * seconds. This opens N real WebSockets, has every one of them answer inside a
 * tight jitter window, and reports fan-out latency, ingest spread, per-answer
 * round-trip percentiles, dropped messages and server RSS.
 *
 * Keep this script after deploy — run it again against the live wss:// endpoint,
 * because TLS + internet latency behave nothing like loopback.
 */

const CLIENTS = Number(process.env.CLIENTS ?? 120);
const JITTER_MS = Number(process.env.JITTER_MS ?? 2000);
/**
 * Fraction of clients that answer. Keep it below 1 to stop the "everyone
 * answered" early-close from firing, so the server-side deadline timer is what
 * closes the question — that is the only way to measure timer accuracy.
 */
const ANSWER_RATE = Number(process.env.ANSWER_RATE ?? 1);
const EMAIL = process.env.TEACHER_EMAIL ?? "demo@example.com";
const PASSWORD = process.env.TEACHER_PASSWORD ?? "demo1234";

/** TARGET may be http(s):// or ws(s):// — both forms are accepted. */
const RAW_TARGET =
  process.env.TARGET ?? `http://localhost:${process.env.SERVER_PORT ?? 3020}`;
const API = RAW_TARGET.replace(/^ws/, "http").replace(/\/$/, "");
const WS = API.replace(/^http/, "ws");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// stats helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[i]!;
}

function summarize(label: string, values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return {
    label,
    n: s.length,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    max: s.at(-1) ?? 0,
  };
}

function table(rows: Array<Record<string, unknown>>) {
  for (const r of rows) {
    console.log(
      "  " +
        Object.entries(r)
          .map(([k, v]) => `${k}=${v}`)
          .join("  "),
    );
  }
}

// ---------------------------------------------------------------------------
// server resource sampling (local runs only — reads the OS, not the app)
// ---------------------------------------------------------------------------

/**
 * The server's own PID, or null if we cannot be sure we found it.
 *
 * The identity check matters: against a container the listener on the published
 * port is `docker-proxy`, and sampling *that* reports a gigabyte of RSS that has
 * nothing to do with the app. A wrong number is worse than no number, so an
 * unrecognised process reports "n/a" instead.
 */
async function serverPid(): Promise<number | null> {
  if (!API.includes("localhost") && !API.includes("127.0.0.1")) return null;
  const port = new URL(API).port || "80";
  const out = await Bun.$`lsof -ti tcp:${port} -sTCP:LISTEN`
    .nothrow()
    .quiet()
    .text();
  const pid = Number(out.trim().split("\n")[0]);
  if (!Number.isFinite(pid) || pid <= 0) return null;

  const command = (
    await Bun.$`ps -o command= -p ${pid}`.nothrow().quiet().text()
  ).trim();
  const isOurServer = command.includes("bun") && command.includes("index.ts");
  return isOurServer ? pid : null;
}

async function sampleRss(pid: number): Promise<{ rssMb: number; cpu: number }> {
  const out = await Bun.$`ps -o rss=,%cpu= -p ${pid}`.nothrow().quiet().text();
  const [rss, cpu] = out.trim().split(/\s+/).map(Number);
  return { rssMb: Math.round((rss ?? 0) / 1024), cpu: cpu ?? 0 };
}

// ---------------------------------------------------------------------------
// a simulated player
// ---------------------------------------------------------------------------

interface Client {
  i: number;
  ws: WebSocket;
  playerId: string | null;
  /** epoch-ms this client received the current QUESTION_SHOWN */
  shownAt: number;
  /** epoch-ms this client sent its answer */
  sentAt: number;
  /** epoch-ms this client's ack for the current question arrived */
  ackAt: number;
  rtts: number[];
  accepted: number;
  rejected: number;
  /** ANSWER_RESULT frames — must be exactly one per question answered */
  results: number;
  /** QUESTION_CLOSED frames — must be exactly one per question */
  closes: number;
  errors: number;
  closedEarly: boolean;
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => reject(new Error("ws open timeout")), 15000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve(ws);
    };
    ws.onerror = (e) => {
      clearTimeout(t);
      reject(e);
    };
  });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

console.log(
  `\nload test → ${API}  clients=${CLIENTS}  jitter=${JITTER_MS}ms\n`,
);

// 1. teacher session + a fresh game
const loginRes = await fetch(`${API}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!loginRes.ok) {
  console.error(`login failed (${loginRes.status}) — run: bun run db:seed`);
  process.exit(1);
}
const { token } = await loginRes.json();
const auth = {
  "content-type": "application/json",
  authorization: `Bearer ${token}`,
};

const { quizzes } = await (
  await fetch(`${API}/api/quizzes`, { headers: auth })
).json();
const quiz =
  quizzes.find((q: any) => q.title.startsWith("Demo Quiz")) ?? quizzes[0];
if (!quiz) {
  console.error("no quiz to play — run: bun run db:seed");
  process.exit(1);
}

const game = await (
  await fetch(`${API}/api/games`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ quizId: quiz.id }),
  })
).json();
const pin: string = game.pin;
console.log(
  `quiz "${quiz.title}" (${quiz.question_count} questions), pin ${pin}`,
);

const pid = await serverPid();
const baselineRss = pid ? (await sampleRss(pid)).rssMb : 0;

// 2. host socket drives the game
const hostMsgs: any[] = [];
const host = await openSocket(`${WS}/ws?pin=${pin}&role=host&token=${token}`);
host.onmessage = (e) => hostMsgs.push(JSON.parse(String(e.data)));

// 3. connect the herd
const clients: Client[] = [];
const connectStart = Date.now();
let connectFailures = 0;

await Promise.all(
  Array.from({ length: CLIENTS }, async (_, i) => {
    try {
      const ws = await openSocket(`${WS}/ws?pin=${pin}&role=player`);
      const c: Client = {
        i,
        ws,
        playerId: null,
        shownAt: 0,
        sentAt: 0,
        ackAt: 0,
        rtts: [],
        accepted: 0,
        rejected: 0,
        results: 0,
        closes: 0,
        errors: 0,
        closedEarly: false,
      };
      ws.onclose = () => {
        c.closedEarly = true;
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        switch (m.type) {
          case "STATE_SNAPSHOT":
            if (m.you) c.playerId = m.you.playerId;
            break;
          case "QUESTION_SHOWN":
            c.shownAt = Date.now();
            c.sentAt = 0;
            break;
          case "ANSWER_ACCEPTED":
            c.accepted++;
            c.ackAt = Date.now();
            if (c.sentAt) c.rtts.push(c.ackAt - c.sentAt);
            break;
          case "ANSWER_REJECTED":
            c.rejected++;
            c.ackAt = Date.now();
            if (c.sentAt) c.rtts.push(c.ackAt - c.sentAt);
            break;
          case "ANSWER_RESULT":
            c.results++;
            break;
          case "QUESTION_CLOSED":
            c.closes++;
            break;
          case "ERROR":
            c.errors++;
            break;
        }
      };
      clients.push(c);
    } catch {
      connectFailures++;
    }
  }),
);

const connectMs = Date.now() - connectStart;
console.log(
  `connected ${clients.length}/${CLIENTS} sockets in ${connectMs}ms` +
    (connectFailures ? `  (${connectFailures} failed)` : ""),
);

// 4. everyone joins
const joinStart = Date.now();
for (const c of clients) {
  c.ws.send(
    JSON.stringify({ type: "PLAYER_JOIN", pin, nickname: `bot${c.i}` }),
  );
}
// wait for identities to settle
for (let i = 0; i < 100 && clients.some((c) => !c.playerId); i++)
  await sleep(50);
const joined = clients.filter((c) => c.playerId).length;
console.log(
  `joined ${joined}/${clients.length} players in ${Date.now() - joinStart}ms\n`,
);

if (joined === 0) {
  console.error("nobody joined — is the game still in LOBBY?");
  process.exit(1);
}

// 5. play every question
const totalQuestions: number = quiz.question_count;
const fanout: number[] = [];
const ingest: number[] = [];
const closeAccuracy: number[] = [];
let peakRss = baselineRss;
let peakCpu = 0;

for (let qi = 0; qi < totalQuestions; qi++) {
  for (const c of clients) {
    c.shownAt = 0;
    c.ackAt = 0;
  }
  hostMsgs.length = 0;

  const openedAt = Date.now();
  host.send(JSON.stringify({ type: "HOST_START_QUESTION", pin }));

  // wait until every client has QUESTION_SHOWN (or we give up)
  for (let i = 0; i < 200 && clients.some((c) => !c.shownAt); i++)
    await sleep(10);
  const got = clients.filter((c) => c.shownAt);
  const lastShown = Math.max(...got.map((c) => c.shownAt));
  fanout.push(lastShown - openedAt);

  const shown = hostMsgs.find((m) => m.type === "QUESTION_SHOWN");
  const questionId = shown?.question?.id;
  const choiceCount = shown?.question?.choices?.length ?? 4;
  const deadline = shown?.question?.deadline ?? 0;

  // every client answers inside the jitter window — the burst
  const answering = got.filter(
    (_, idx) => idx < Math.ceil(got.length * ANSWER_RATE),
  );
  const firstSend = Date.now();
  await Promise.all(
    answering.map(async (c) => {
      await sleep(Math.random() * JITTER_MS);
      c.sentAt = Date.now();
      c.ws.send(
        JSON.stringify({
          type: "PLAYER_ANSWER",
          questionId,
          choiceIndex: c.i % choiceCount,
        }),
      );
    }),
  );

  const sendWindow = Date.now() - firstSend;

  // wait for the acks, then measure ingest from the acks themselves — timing it
  // around this loop would fold the poll interval into the number.
  const before = got.reduce((n, c) => n + c.accepted + c.rejected, 0);
  for (let i = 0; i < 600; i++) {
    const now = got.reduce((n, c) => n + c.accepted + c.rejected, 0);
    if (now - before >= answering.length) break;
    await sleep(5);
  }
  const acks = answering.map((c) => c.ackAt).filter(Boolean);
  ingest.push(acks.length ? Math.max(...acks) - Math.min(...acks) : 0);

  // sample resources right after the burst (spawning ps is slow — never inside
  // a timed section)
  if (pid) {
    const s = await sampleRss(pid);
    peakRss = Math.max(peakRss, s.rssMb);
    peakCpu = Math.max(peakCpu, s.cpu);
  }

  // Let the question close. With ANSWER_RATE < 1 the early-close never fires, so
  // this must outlast the question's own time limit — derive the wait from the
  // server's deadline rather than guessing.
  const closeBudgetMs = (deadline ? deadline - Date.now() : 20_000) + 5_000;
  for (let i = 0; i < Math.ceil(closeBudgetMs / 25); i++) {
    if (hostMsgs.some((m) => m.type === "QUESTION_CLOSED")) break;
    await sleep(25);
  }
  const closedAt = Date.now();
  if (deadline) closeAccuracy.push(closedAt - deadline);

  const closed = hostMsgs.find((m) => m.type === "QUESTION_CLOSED");
  const counted =
    closed?.tally?.reduce((a: number, b: number) => a + b, 0) ?? 0;
  console.log(
    `Q${qi + 1}: fanout=${fanout[qi]}ms  ackSpread=${ingest[qi]}ms  sendWindow=${sendWindow}ms  tallied=${counted}/${answering.length}`,
  );

  host.send(JSON.stringify({ type: "HOST_NEXT", pin })); // -> LEADERBOARD
  await sleep(250);
}

// 6. finish
host.send(JSON.stringify({ type: "HOST_NEXT", pin }));
await sleep(800);

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const allRtts = clients.flatMap((c) => c.rtts);
const accepted = clients.reduce((n, c) => n + c.accepted, 0);
const rejected = clients.reduce((n, c) => n + c.rejected, 0);
const errors = clients.reduce((n, c) => n + c.errors, 0);
const expected = Math.ceil(clients.length * ANSWER_RATE) * totalQuestions;
const dropped = expected - (accepted + rejected);
const droppedSockets = clients.filter((c) => c.closedEarly).length;

console.log(`\n${"=".repeat(58)}`);
console.log(
  `clients=${clients.length}  questions=${totalQuestions}  jitter=${JITTER_MS}ms`,
);
console.log("=".repeat(58));

table([
  summarize("answer round-trip (ms)", allRtts),
  summarize("broadcast fan-out (ms)", fanout),
  summarize("ack spread, first→last (ms)", ingest),
]);

console.log("");
table([
  {
    accepted,
    rejected,
    errors,
    dropped: dropped < 0 ? 0 : dropped,
    socketsClosedEarly: droppedSockets,
  },
  {
    closeVsDeadlineMs: closeAccuracy.length
      ? `p50=${percentile(
          [...closeAccuracy].sort((a, b) => a - b),
          50,
        )} max=${Math.max(...closeAccuracy)}`
      : "n/a",
  },
  pid
    ? { serverRssMb: `${baselineRss}→${peakRss}`, peakCpuPct: peakCpu }
    : {
        serverRssMb:
          "n/a — target is remote or behind a proxy (use `docker stats`)",
      },
]);

// A question must be scored exactly once no matter how many answers land in the
// same burst. Duplicates here mean the close/score path lost its atomic claim,
// which silently multiplies every score (see store.claimScoring).
const answeredQuestions = Math.round(accepted / Math.max(1, clients.length));
const dupResults = clients.filter((c) => c.results > answeredQuestions).length;
const dupCloses = clients.filter((c) => c.closes > totalQuestions).length;
const worstResults = Math.max(0, ...clients.map((c) => c.results));
const worstCloses = Math.max(0, ...clients.map((c) => c.closes));

console.log("");
table([
  {
    scoredOncePerQuestion:
      dupResults === 0 && dupCloses === 0 ? "OK" : "BROKEN",
    maxAnswerResults: `${worstResults} (expect <= ${answeredQuestions})`,
    maxQuestionClosed: `${worstCloses} (expect <= ${totalQuestions})`,
  },
]);

const clean =
  dropped <= 0 &&
  errors === 0 &&
  droppedSockets === 0 &&
  dupResults === 0 &&
  dupCloses === 0;
console.log(
  `\n${clean ? "CLEAN — no dropped messages" : "DEGRADED — investigate the counts above"}\n`,
);
process.exit(clean ? 0 : 1);
