import { PROFILES } from "../lang/profiles";
import type { LanguageCode, QuizAnswer, QuizCategory } from "../tools/types";
import type { TranscriptState, ToolItem } from "./transcriptStore";

const CATEGORIES: QuizCategory[] = ["translation", "vocabulary", "grammar", "comprehension"];
const LANGUAGES = new Set<LanguageCode>(Object.keys(PROFILES) as LanguageCode[]);

export interface QuizCategoryScore {
  category: QuizCategory;
  points: number;
  possible: number;
  attempts: number;
}

export interface QuizState {
  answers: QuizAnswer[];
  score: number;
  possible: number;
  attempted: number;
  complete: boolean;
  categories: QuizCategoryScore[];
  recommendation: QuizCategory | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function isQuizAnswer(value: unknown): value is QuizAnswer {
  const item = record(value);
  if (!item || item.type !== "quiz_answer") return false;
  return (
    typeof item.language === "string" && LANGUAGES.has(item.language as LanguageCode) &&
    typeof item.questionNumber === "number" && Number.isInteger(item.questionNumber) && item.questionNumber >= 1 && item.questionNumber <= 5 &&
    typeof item.category === "string" && CATEGORIES.includes(item.category as QuizCategory) &&
    (item.source === "review" || item.source === "general") &&
    typeof item.question === "string" && item.question.length > 0 &&
    typeof item.learnerAnswer === "string" && item.learnerAnswer.length > 0 &&
    typeof item.referenceAnswer === "string" && item.referenceAnswer.length > 0 &&
    (item.points === 0 || item.points === 1 || item.points === 2) &&
    typeof item.feedback === "string" && item.feedback.length > 0
  );
}

function answerFrom(item: ToolItem): QuizAnswer | null {
  if (item.name !== "grade_quiz_answer" || item.status !== "ok") return null;
  const result = record(item.result);
  return result && isQuizAnswer(result.detail) ? result.detail : null;
}

/** Pure quiz view: first valid grade per question is authoritative. */
export function quizFromTranscript(state: TranscriptState): QuizState {
  const seen = new Set<number>();
  const answers: QuizAnswer[] = [];
  for (const id of state.order) {
    const item = state.items[id];
    if (item.kind !== "tool") continue;
    const answer = answerFrom(item);
    if (!answer || seen.has(answer.questionNumber)) continue;
    seen.add(answer.questionNumber);
    answers.push(answer);
  }

  const categories = CATEGORIES.map((category) => {
    const matching = answers.filter((answer) => answer.category === category);
    return {
      category,
      points: matching.reduce((sum, answer) => sum + answer.points, 0),
      possible: matching.length * 2,
      attempts: matching.length,
    };
  });
  const attempted = answers.length;
  const used = categories.filter((category) => category.attempts > 0);
  const recommendation = used.length === 0
    ? null
    : [...used].sort((a, b) => {
        const average = a.points / a.possible - b.points / b.possible;
        if (average !== 0) return average;
        if (a.attempts !== b.attempts) return b.attempts - a.attempts;
        return CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category);
      })[0].category;

  return {
    answers,
    score: answers.reduce((sum, answer) => sum + answer.points, 0),
    possible: attempted * 2,
    attempted,
    complete: attempted === 5,
    categories,
    recommendation,
  };
}
