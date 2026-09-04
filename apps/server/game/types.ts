import type { QuestionKind, QuestionMedia, QuizTheme } from "@shared/protocol";
import type { GameState } from "./machine";

/** A question as the server holds it — includes the answer. Never sent whole to clients. */
export interface EngineQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  media: QuestionMedia;
  choices: string[];
  correctIndex: number;
  timeLimitSeconds: number;
  maxPoints: number;
}

export interface CurrentQuestion {
  questionId: string;
  index: number;
  /** epoch-ms the question was shown (server clock) */
  askedAt: number;
  /** epoch-ms answers close (server clock) */
  deadline: number;
}

/** The whole live session. Lives in `live_games`, never in process memory. */
export interface Snapshot {
  pin: string;
  sessionId: string;
  quizId: string;
  quizTitle: string;
  /** backdrop shown while this quiz is on the projector */
  theme: QuizTheme;
  state: GameState;
  /** index of the question in play; -1 in the lobby */
  questionIndex: number;
  totalQuestions: number;
  questions: EngineQuestion[];
  current: CurrentQuestion | null;
}

export interface PlayerRecord {
  nickname: string;
  /** animal emoji chosen on the join screen (or assigned) */
  avatar: string;
  joinedAt: number;
}

export interface AnswerRecord {
  choiceIndex: number;
  /** epoch-ms the server accepted it */
  answeredAt: number;
}

export interface AnswerLogEntry {
  questionId: string;
  choiceIndex: number;
  correct: boolean;
  points: number;
}
