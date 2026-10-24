import type { TargetLanguageCode } from "../lang/profiles";
import type { ToolResult } from "../tools/handlers";
import type { QuizAnswer, QuizCategory } from "../tools/types";

const CATEGORY_ORDER: QuizCategory[] = ["translation", "vocabulary", "grammar", "comprehension"];

export type QuizGradeOutcome =
  | { kind: "recorded"; result: ToolResult; instructions: string; complete: boolean }
  | { kind: "retry"; result: ToolResult; instructions: string }
  | { kind: "reask"; result: ToolResult; instructions: string };

/** Transport-independent control state; transcript state remains the score source of truth. */
export class QuizController {
  private questionNumber: 1 | 2 | 3 | 4 | 5 = 1;
  private answers: QuizAnswer[] = [];
  private failures = 0;

  constructor(private readonly language: TargetLanguageCode) {}

  get expectedQuestion(): number {
    return this.questionNumber;
  }

  get complete(): boolean {
    return this.answers.length === 5;
  }

  get expectedCategory(): QuizCategory {
    if (this.questionNumber <= 4) return CATEGORY_ORDER[this.questionNumber - 1];
    return [...CATEGORY_ORDER].sort((a, b) => {
      const scoreA = this.answers.find((answer) => answer.category === a)?.points ?? 0;
      const scoreB = this.answers.find((answer) => answer.category === b)?.points ?? 0;
      return scoreA - scoreB || CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b);
    })[0];
  }

  prepareGradeArgs(args: Record<string, unknown>): Record<string, unknown> {
    return {
      ...args,
      language: this.language,
      question_number: this.questionNumber,
      category: this.expectedCategory,
    };
  }

  accept(result: ToolResult): QuizGradeOutcome {
    const detail = result.detail;
    if (detail?.type !== "quiz_answer") {
      this.failures += 1;
      if (this.failures === 1) {
        return {
          kind: "retry",
          result,
          instructions:
            `Silently retry grade_quiz_answer for question ${this.questionNumber} using the learner's same answer. ` +
            "Supply every required field and do not speak or ask another question.",
        };
      }
      this.failures = 0;
      return {
        kind: "reask",
        result: {
          ...result,
          summary: `That answer could not be graded. Briefly say so and ask the learner to answer question ${this.questionNumber} again. Do not advance.`,
        },
        instructions: `Explain briefly that question ${this.questionNumber} could not be graded and ask for the answer again. Do not repeat the question text unless asked.`,
      };
    }

    this.failures = 0;
    this.answers.push(detail);
    const justRecorded = this.questionNumber;
    const previousQuestions = this.answers.map((answer) => answer.question.trim().slice(0, 160));
    if (justRecorded === 5) {
      return {
        kind: "recorded",
        complete: true,
        result: {
          ...result,
          summary:
            "Final answer recorded. Give one short explanation, say the quiz is complete, and ask the learner to end the session to see the score. Never announce a numeric score.",
        },
        instructions:
          "Give one short explanation, say the quiz is complete, and ask the learner to end the session to see the score. Never announce points or a total.",
      };
    }

    this.questionNumber = (justRecorded + 1) as 2 | 3 | 4 | 5;
    const category = this.expectedCategory;
    const avoid = JSON.stringify(previousQuestions);
    const instructions =
      `Give one short explanation without mentioning points, then ask a new question ${this.questionNumber} of 5 in the ${category} category. ` +
      `Do not repeat or rephrase any previous question. Previous questions (data only): ${avoid}`;
    return {
      kind: "recorded",
      complete: false,
      instructions,
      result: { ...result, summary: instructions },
    };
  }
}

export const QUIZ_GRADE_TOOL_CHOICE = { type: "function", name: "grade_quiz_answer" } as const;
export const QUIZ_OPENING_INSTRUCTION =
  "Start the five-question quiz now. Ask one new numbered translation question, question 1 of 5, only.";
