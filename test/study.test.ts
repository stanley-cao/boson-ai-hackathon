import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../src/realtime/events";
import { studyFromTranscript } from "../src/state/study";
import {
  CLIENT_TOOL_RESULT,
  emptyTranscript,
  transcriptReducer,
  type TranscriptState,
} from "../src/state/transcriptStore";

const evt = (event: Record<string, unknown>) => event as ServerEvent;

function addTool(
  state: TranscriptState,
  itemId: string,
  callId: string,
  name: string,
  result?: unknown,
): TranscriptState {
  let next = transcriptReducer(
    state,
    evt({
      type: "response.output_item.added",
      item: { id: itemId, type: "function_call", name, call_id: callId },
    }),
    Number(itemId.replace(/\D/g, "")) || 1,
  );

  if (result !== undefined) {
    next = transcriptReducer(
      next,
      evt({ type: CLIENT_TOOL_RESULT, call_id: callId, result, ms: 2 }),
      100,
    );
  }
  return next;
}

describe("studyFromTranscript", () => {
  it("derives ordered study details from successful transcript tool items", () => {
    let state = emptyTranscript;
    state = addTool(state, "i1", "c1", "note_correction", {
      summary: "Correction saved.",
      detail: {
        type: "correction",
        language: "zh",
        said: "我喜欢学习中文了",
        correct: "我喜欢学习中文",
        explanation: "The completed-action particle is not needed here.",
        kind: "grammar",
      },
    });
    state = addTool(state, "i2", "c2", "save_phrase", {
      summary: "Phrase saved.",
      detail: {
        type: "phrase",
        language: "zh",
        phrase: "加油",
        meaning: "keep going",
        romanization: "jiā yóu",
      },
    });
    state = addTool(state, "i3", "c3", "note_correction", {
      summary: "Another correction saved.",
      detail: {
        type: "correction",
        language: "zh",
        said: "两书",
        correct: "两本书",
        explanation: "Books take the measure word 本.",
        kind: "grammar",
      },
    });
    state = addTool(state, "i4", "c4", "pronunciation_feedback", {
      summary: "Pronunciation note saved.",
      detail: {
        type: "pronunciation",
        language: "zh",
        target: "好",
        romanization: "hǎo",
        issue: "tone",
        tip: "Let the pitch dip before it rises.",
      },
    });

    const study = studyFromTranscript(state);
    expect(study.corrections.map((item) => item.correct)).toEqual(["我喜欢学习中文", "两本书"]);
    expect(study.phrases.map((item) => item.phrase)).toEqual(["加油"]);
    expect(study.pronunciationNotes.map((item) => item.target)).toEqual(["好"]);
  });

  it("uses the latest valid practice-language selection", () => {
    let state = emptyTranscript;
    state = addTool(state, "i1", "c1", "set_practice_language", {
      summary: "Practising English.",
      detail: { type: "practice_language", language: "en", level: "beginner" },
    });
    state = addTool(state, "i2", "c2", "set_practice_language", {
      summary: "Practising Mandarin.",
      detail: { type: "practice_language", language: "zh", level: "intermediate" },
    });

    expect(studyFromTranscript(state).practiceLanguage).toEqual({
      type: "practice_language",
      language: "zh",
      level: "intermediate",
    });
  });

  it("ignores incomplete, failed, unrelated, mismatched and malformed results", () => {
    let state = emptyTranscript;
    state = addTool(state, "i1", "c1", "save_phrase");
    state = addTool(state, "i2", "c2", "save_phrase", {
      summary: "Failed.",
      error: "tool_failed",
      detail: { type: "phrase", language: "zh", phrase: "你好", meaning: "hello" },
    });
    state = addTool(state, "i3", "c3", "web_search", {
      summary: "One result.",
      detail: { results: [], total: 0 },
    });
    state = addTool(state, "i4", "c4", "save_phrase", {
      summary: "Wrong detail.",
      detail: {
        type: "correction",
        language: "zh",
        said: "a",
        correct: "b",
        explanation: "c",
        kind: "other",
      },
    });
    state = addTool(state, "i5", "c5", "note_correction", {
      summary: "Malformed detail.",
      detail: { type: "correction", language: "zh", said: "a" },
    });
    state = addTool(state, "i6", "c6", "save_phrase", { summary: "No detail." });

    expect(studyFromTranscript(state)).toEqual({
      corrections: [],
      phrases: [],
      pronunciationNotes: [],
      practiceLanguage: null,
    });
  });

  it("returns an empty view for an empty transcript", () => {
    expect(studyFromTranscript(emptyTranscript)).toEqual({
      corrections: [],
      phrases: [],
      pronunciationNotes: [],
      practiceLanguage: null,
    });
  });

  it("does not mutate the transcript", () => {
    const state = addTool(emptyTranscript, "i1", "c1", "save_phrase", {
      summary: "Phrase saved.",
      detail: { type: "phrase", language: "zh", phrase: "谢谢", meaning: "thank you" },
    });
    const before = structuredClone(state);

    studyFromTranscript(state);

    expect(state).toEqual(before);
  });
});
