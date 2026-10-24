import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../src/realtime/events";
import { CLIENT_TOOL_RESULT, emptyTranscript, toDisplayList, toPlainText, transcriptReducer, type TranscriptState } from "../src/state/transcriptStore";
import { quizFromTranscript } from "../src/state/quiz";

function add(state: TranscriptState, id: string, questionNumber: number, points: number, category = "translation") {
  state = transcriptReducer(state, {
    type: "response.output_item.added",
    item: { id, type: "function_call", call_id: `c${id}`, name: "grade_quiz_answer" },
  } as ServerEvent, questionNumber);
  return transcriptReducer(state, {
    type: CLIENT_TOOL_RESULT,
    call_id: `c${id}`,
    result: {
      summary: "recorded",
      detail: {
        type: "quiz_answer", language: "zh", questionNumber, category, source: "general",
        question: `Question ${questionNumber}`, learnerAnswer: "answer", referenceAnswer: "reference",
        points, feedback: "Useful feedback.",
      },
    },
  } as ServerEvent, questionNumber + 10);
}

describe("quizFromTranscript", () => {
  it("computes ordered totals and completion from five valid grades", () => {
    let state = emptyTranscript;
    for (const [q, p] of [[1, 2], [2, 1], [3, 0], [4, 2], [5, 1]]) state = add(state, `i${q}`, q, p);
    const quiz = quizFromTranscript(state);
    expect(quiz.answers.map((answer) => answer.questionNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(quiz).toMatchObject({ score: 6, possible: 10, attempted: 5, complete: true });
    expect(toDisplayList(state)).toEqual([]);
    expect(toPlainText(state)).not.toContain("points");
  });

  it("keeps the first grade per number and supports partial quizzes without mutation", () => {
    let state = add(emptyTranscript, "i1", 1, 1, "grammar");
    state = add(state, "i2", 1, 2, "vocabulary");
    const before = structuredClone(state);
    expect(quizFromTranscript(state)).toMatchObject({ score: 1, possible: 2, attempted: 1, complete: false, recommendation: "grammar" });
    expect(state).toEqual(before);
  });

  it("ignores failed, malformed, and non-quiz tool results", () => {
    let state = transcriptReducer(emptyTranscript, {
      type: "response.output_item.added", item: { id: "bad", type: "function_call", call_id: "bad", name: "grade_quiz_answer" },
    } as ServerEvent, 1);
    state = transcriptReducer(state, {
      type: CLIENT_TOOL_RESULT, call_id: "bad", result: { summary: "no", error: "invalid_points", detail: { type: "quiz_answer", points: 4 } },
    } as ServerEvent, 2);
    expect(quizFromTranscript(state)).toMatchObject({ answers: [], score: 0, possible: 0, attempted: 0, complete: false, recommendation: null });
  });
});
