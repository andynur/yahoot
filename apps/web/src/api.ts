import type { QuestionKind, QuestionMedia } from "@shared/protocol";
import type { QuizTheme } from "@shared/wire";
import { API_BASE } from "./config";

const TOKEN_KEY = "yahoot:token";

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null): void => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new Error((body.error as string) ?? `request failed (${res.status})`);
  return body as T;
}

export interface QuizSummary {
  id: string;
  title: string;
  question_count: number;
  created_at: string;
  theme: QuizTheme;
  defaultTimeLimitSeconds: number;
  defaultMaxPoints: number;
}

/** A question as the editor holds it (camelCase, matches the REST body). */
export interface QuestionDraft {
  id?: string;
  kind: QuestionKind;
  prompt: string;
  media: QuestionMedia;
  choices: string[];
  correctIndex: number;
  timeLimitSeconds: number;
  maxPoints: number;
}

export interface QuizDetail {
  id: string;
  title: string;
  created_at: string;
  theme: QuizTheme;
  defaultTimeLimitSeconds: number;
  defaultMaxPoints: number;
  questions: QuestionDraft[];
}

export interface QuizPayload {
  title: string;
  defaultTimeLimitSeconds: number;
  defaultMaxPoints: number;
  theme: QuizTheme;
  questions: QuestionDraft[];
}

export interface AuthResponse {
  token: string;
  teacher: { id: string; email: string };
}

export interface CreatedGame {
  pin: string;
  sessionId: string;
  quizTitle: string;
  theme: QuizTheme;
}

export function blankQuestion(
  kind: QuestionKind = "multiple_choice",
  defaults: { timeLimitSeconds?: number; maxPoints?: number } = {},
): QuestionDraft {
  return {
    kind,
    prompt: "",
    media: { kind: "none" },
    choices: kind === "true_false" ? ["True", "False"] : ["", "", "", ""],
    correctIndex: 0,
    timeLimitSeconds: defaults.timeLimitSeconds ?? 20,
    maxPoints: defaults.maxPoints ?? 1000,
  };
}

export interface SessionSummary {
  id: string;
  pin: string;
  status: string;
  quizTitle: string;
  createdAt: string;
  endedAt: string | null;
  playerCount: number;
  topScore: number;
}

export interface SessionReport {
  session: {
    id: string;
    pin: string;
    status: string;
    quizTitle: string;
    createdAt: string;
    endedAt: string | null;
  };
  results: Array<{
    playerId: string;
    nickname: string;
    score: number;
    rank: number;
    correctCount: number;
  }>;
  questions: Array<{
    questionId: string;
    index: number;
    prompt: string;
    kind: string | null;
    answered: number;
    correct: number;
    correctPct: number;
    averagePoints: number;
  }>;
}

export const api = {
  register: (email: string, password: string) =>
    request<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  listQuizzes: () => request<{ quizzes: QuizSummary[] }>("/api/quizzes"),
  getQuiz: (id: string) => request<{ quiz: QuizDetail }>(`/api/quizzes/${id}`),
  createQuiz: (payload: QuizPayload) =>
    request<{ id: string }>("/api/quizzes", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateQuiz: (id: string, payload: QuizPayload) =>
    request<{ ok: true }>(`/api/quizzes/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteQuiz: (id: string) =>
    request<{ ok: true }>(`/api/quizzes/${id}`, { method: "DELETE" }),

  listSessions: () => request<{ sessions: SessionSummary[] }>("/api/sessions"),
  getSessionReport: (id: string) =>
    request<SessionReport>(`/api/sessions/${id}/report`),

  createGame: (quizId: string) =>
    request<CreatedGame>("/api/games", {
      method: "POST",
      body: JSON.stringify({ quizId }),
    }),

  /**
   * Upload an image file. Returns the `/uploads/…` path to store as media.url,
   * plus the size the server actually kept — it re-encodes what it receives, so
   * this is smaller than what we sent, and it is the number students pay for.
   */
  async uploadImage(file: File): Promise<{ url: string; bytes: number }> {
    const token = getToken();
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/api/uploads`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok)
      throw new Error(
        (body.error as string) ?? `upload failed (${res.status})`,
      );
    return {
      url: body.url as string,
      bytes: (body.bytes as number) ?? file.size,
    };
  },
};
