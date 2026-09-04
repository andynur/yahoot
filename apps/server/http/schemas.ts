/** Zod schemas for REST request bodies. WS messages live in @shared/protocol. */
import { z } from "zod";
import {
  isYouTubeUrl,
  QuestionKind,
  QuestionMedia,
  QuizTheme,
} from "@shared/protocol";

export const Credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(200),
});
export type Credentials = z.infer<typeof Credentials>;

/** Only http(s) links or our own /uploads/… paths are allowed as media URLs. */
const MediaUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u) || u.startsWith("/uploads/"), {
    message: "media url must be http(s) or an /uploads/ path",
  });

/**
 * Video means YouTube, and nothing else. Rejected here rather than hidden in the
 * UI so a stray `.mp4` cannot reach the database through the REST API either —
 * the player would then stream it from our own box to every phone in the room.
 */
const YouTubeUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(isYouTubeUrl, { message: "paste a YouTube link" });

const MediaInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("image"), url: MediaUrl }),
  z.object({ kind: z.literal("video"), url: YouTubeUrl }),
]);

export const QuestionInput = z
  .object({
    kind: QuestionKind.default("multiple_choice"),
    prompt: z.string().trim().min(1).max(500),
    media: MediaInput.default({ kind: "none" }),
    choices: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
    correctIndex: z.number().int().nonnegative(),
    timeLimitSeconds: z.number().int().min(5).max(120).default(20),
    maxPoints: z.number().int().min(100).max(5000).default(1000),
  })
  .superRefine((q, ctx) => {
    if (q.correctIndex >= q.choices.length) {
      ctx.addIssue({
        code: "custom",
        message: "correctIndex is outside the choices array",
        path: ["correctIndex"],
      });
    }
    if (q.kind === "true_false" && q.choices.length !== 2) {
      ctx.addIssue({
        code: "custom",
        message: "a true/false question must have exactly two choices",
        path: ["choices"],
      });
    }
    if (q.kind === "multiple_choice" && q.choices.length < 2) {
      ctx.addIssue({
        code: "custom",
        message: "a multiple-choice question needs at least two choices",
        path: ["choices"],
      });
    }
  });
export type QuestionInput = z.infer<typeof QuestionInput>;

const ThemeInput = z.object({
  preset: QuizTheme.shape.preset.default("purple"),
  image: MediaUrl.optional(),
});

export const QuizInput = z.object({
  title: z.string().trim().min(1).max(200),
  /** starting value for new questions + what "apply to all" writes */
  defaultTimeLimitSeconds: z.number().int().min(5).max(120).default(20),
  defaultMaxPoints: z.number().int().min(100).max(5000).default(1000),
  theme: ThemeInput.default({ preset: "purple" }),
  questions: z.array(QuestionInput).min(1).max(50),
});
export type QuizInput = z.infer<typeof QuizInput>;

export const CreateGameInput = z.object({
  quizId: z.uuid(),
});

// Re-exported so other server modules have one import site.
export { QuestionMedia, QuizTheme };
