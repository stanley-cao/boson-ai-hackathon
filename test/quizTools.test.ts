import { describe, expect, it } from "vitest";
import { gradeQuizAnswer } from "../src/tools/handlers";
import { TOOL_DEFINITIONS } from "../src/tools/definitions";

const valid = {
  language: "Mandarin",
  question_number: 2,
  category: "vocabulary",
  source: "review",
  question: "Translate hello.",
  learner_answer: "你好",
  reference_answer: "你好",
  points: 2,
  feedback: "Correct and complete.",
};

describe("grade_quiz_answer", () => {
  it.each([0, 1, 2])("records a valid %i-point grade and normalizes language", (points) => {
    expect(gradeQuizAnswer({ ...valid, language: "zh-CN", points }).detail).toMatchObject({
      type: "quiz_answer", language: "zh", questionNumber: 2, points,
    });
  });

  it("returns errors for malformed fields and invalid points", () => {
    expect(gradeQuizAnswer({ ...valid, points: 3 }).error).toBe("invalid_points");
    expect(gradeQuizAnswer({ ...valid, learner_answer: " " }).error).toBe("missing_fields");
    expect(gradeQuizAnswer({ ...valid, question_number: 6 }).error).toBe("invalid_question_number");
  });

  it("publishes the strict five-question scoring contract", () => {
    const tool = TOOL_DEFINITIONS.find((item) => item.name === "grade_quiz_answer");
    expect(tool?.description).toContain("FIRST");
    expect(tool?.parameters.required).toContain("points");
  });
});
