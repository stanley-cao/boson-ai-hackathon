import { describe, expect, it } from "vitest";
import { QuizController } from "../src/quiz/controller";
import { gradeQuizAnswer } from "../src/tools/handlers";

function modelArgs(questionNumber: number, points: number, question = `Question ${questionNumber}`) {
  return {
    language: "French",
    question_number: questionNumber,
    category: "comprehension",
    source: "general",
    question,
    learner_answer: "learner answer",
    reference_answer: "reference answer",
    points,
    feedback: "Brief feedback.",
  };
}

describe("QuizController", () => {
  it("owns sequential numbering and the structured category mix", () => {
    const controller = new QuizController("zh");
    const expected = ["translation", "vocabulary", "grammar", "comprehension"];
    for (let index = 0; index < 4; index++) {
      const args = controller.prepareGradeArgs(modelArgs(1, index === 1 ? 0 : 2));
      expect(args).toMatchObject({ language: "zh", question_number: index + 1, category: expected[index] });
      expect(controller.accept(gradeQuizAnswer(args))).toMatchObject({ kind: "recorded", complete: false });
    }
    // Vocabulary scored lowest; question five adapts to it.
    expect(controller.prepareGradeArgs(modelArgs(1, 2))).toMatchObject({ question_number: 5, category: "vocabulary" });
  });

  it("prevents repeated model-supplied numbers from stalling progress", () => {
    const controller = new QuizController("ko");
    for (let question = 1; question <= 5; question++) {
      const args = controller.prepareGradeArgs(modelArgs(1, 2, `Unique ${question}`));
      const outcome = controller.accept(gradeQuizAnswer(args));
      expect((outcome.result.detail as { questionNumber: number }).questionNumber).toBe(question);
    }
    expect(controller.complete).toBe(true);
  });

  it("requests one silent retry before keeping the current question", () => {
    const controller = new QuizController("ja");
    expect(controller.accept({ summary: "bad", error: "missing_fields" }).kind).toBe("retry");
    expect(controller.accept({ summary: "bad", error: "missing_fields" })).toMatchObject({ kind: "reask" });
    expect(controller.expectedQuestion).toBe(1);
  });

  it("instructs every next turn to avoid previous questions and hides scores", () => {
    const controller = new QuizController("sr");
    const args = controller.prepareGradeArgs(modelArgs(4, 2, "Translate hello"));
    const outcome = controller.accept(gradeQuizAnswer(args));
    expect(outcome.instructions).toContain("Do not repeat or rephrase");
    expect(outcome.instructions).toContain("question 2");
    expect(outcome.instructions).not.toContain("2/2");
  });
});
