import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../src/realtime/events";
import {
  emptyStudyState,
  freshSessionTranscript,
  studyFromTranscript,
  transcriptFromStudy,
  withoutStudyItems,
} from "../src/state/study";
import {
  CLIENT_TOOL_RESULT,
  emptyTranscript,
  toDisplayList,
  toPlainText,
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

  it("accepts every practice level, including advanced", () => {
    const state = addTool(emptyTranscript, "i1", "c1", "set_practice_language", {
      summary: "Now practising Mandarin Chinese at advanced level.",
      detail: { type: "practice_language", language: "zh", level: "advanced" },
    });
    expect(studyFromTranscript(state).practiceLanguage?.level).toBe("advanced");
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

  it("rehydrates stored data as transcript items, collapsing identical entries", () => {
    const stored = emptyStudyState();
    stored.phrases.push({
      type: "phrase",
      language: "zh",
      phrase: "加油",
      meaning: "keep going",
    });
    const current = emptyStudyState();
    current.phrases.push(
      stored.phrases[0],
      { type: "phrase", language: "zh", phrase: "谢谢", meaning: "thank you" },
    );
    current.practiceLanguage = {
      type: "practice_language",
      language: "zh",
      level: "intermediate",
    };

    const hydrated = transcriptFromStudy({
      corrections: [],
      phrases: [...stored.phrases, ...current.phrases],
      pronunciationNotes: [],
      practiceLanguage: current.practiceLanguage,
    });
    const restored = studyFromTranscript(hydrated);

    // 加油 was saved in both sessions; the panel shows it once, first place kept.
    expect(restored.phrases.map((item) => item.phrase)).toEqual(["加油", "谢谢"]);
    expect(restored.practiceLanguage?.level).toBe("intermediate");
    expect(hydrated.order.every((id) => hydrated.items[id].kind === "tool")).toBe(true);
    expect(toDisplayList(hydrated)).toEqual([]);
    expect(toPlainText(hydrated)).toBe("");
  });

  it("clears study tool items without removing conversation turns", () => {
    let state = transcriptReducer(
      emptyTranscript,
      evt({ type: "input_audio_buffer.speech_started", item_id: "user-1" }),
      1,
    );
    state = addTool(state, "tool-1", "c1", "save_phrase", {
      summary: "Phrase saved.",
      detail: { type: "phrase", language: "zh", phrase: "加油", meaning: "keep going" },
    });
    state = addTool(state, "tool-2", "c2", "web_search", {
      summary: "Search complete.",
    });

    const cleared = withoutStudyItems(state);
    expect(cleared.order).toEqual(["user-1", "tool-2"]);
    expect(cleared.items["user-1"].kind).toBe("user");
    expect(cleared.items["tool-2"].kind).toBe("tool");
    expect(studyFromTranscript(cleared)).toEqual(emptyStudyState());
  });

  it("starts a new session with the study items but none of the old conversation", () => {
    let state = transcriptReducer(
      emptyTranscript,
      evt({ type: "input_audio_buffer.speech_started", item_id: "user-1" }),
      1,
    );
    state = addTool(state, "tool-1", "c1", "save_phrase", {
      summary: "Phrase saved.",
      detail: { type: "phrase", language: "zh", phrase: "加油", meaning: "keep going" },
    });

    const fresh = freshSessionTranscript(state);
    expect(toDisplayList(fresh)).toEqual([]);
    expect(studyFromTranscript(fresh)).toEqual(studyFromTranscript(state));
  });

  it("starts a new session empty when nothing was studied", () => {
    const state = transcriptReducer(
      emptyTranscript,
      evt({ type: "input_audio_buffer.speech_started", item_id: "user-1" }),
      1,
    );
    expect(freshSessionTranscript(state)).toEqual(emptyTranscript);
  });
});

describe("studyFromTranscript duplicates", () => {
  const correction = {
    type: "correction",
    language: "ja",
    said: "Watashi Sam desu",
    correct: "Watashi wa Sam desu",
    explanation: "The particle wa marks the subject.",
    kind: "grammar",
  };

  it("keeps one of identical entries from a doubled tool call", () => {
    let state = emptyTranscript;
    state = addTool(state, "i1", "c1", "note_correction", { summary: "Saved.", detail: correction });
    state = addTool(state, "i2", "c2", "note_correction", { summary: "Saved.", detail: correction });
    state = addTool(state, "i3", "c3", "save_phrase", {
      summary: "Saved.",
      detail: { type: "phrase", language: "fr", phrase: "Bonjour", meaning: "Hello" },
    });
    state = addTool(state, "i4", "c4", "save_phrase", {
      summary: "Saved.",
      detail: { type: "phrase", language: "fr", phrase: "bonjour ", meaning: "Hi" },
    });
    const study = studyFromTranscript(state);
    expect(study.corrections).toHaveLength(1);
    expect(study.phrases.map((p) => p.meaning)).toEqual(["Hello"]);
  });

  it("keeps different corrections of the same sentence", () => {
    let state = emptyTranscript;
    state = addTool(state, "i1", "c1", "note_correction", { summary: "Saved.", detail: correction });
    state = addTool(state, "i2", "c2", "note_correction", {
      summary: "Saved.",
      detail: { ...correction, correct: "Watashi no namae wa Sam desu" },
    });
    expect(studyFromTranscript(state).corrections).toHaveLength(2);
  });
});
