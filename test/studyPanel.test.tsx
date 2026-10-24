import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../src/realtime/events";
import { transcriptFromStudy } from "../src/state/study";
import {
  CLIENT_TOOL_RESULT,
  emptyTranscript,
  transcriptReducer,
  type TranscriptState,
} from "../src/state/transcriptStore";
import { StudyPanel } from "../src/ui/StudyPanel";

const evt = (event: Record<string, unknown>) => event as ServerEvent;

function addTool(
  state: TranscriptState,
  itemId: string,
  callId: string,
  name: string,
  result: unknown,
): TranscriptState {
  const pending = transcriptReducer(
    state,
    evt({
      type: "response.output_item.added",
      item: { id: itemId, type: "function_call", name, call_id: callId },
    }),
    1,
  );
  return transcriptReducer(
    pending,
    evt({ type: CLIENT_TOOL_RESULT, call_id: callId, result, ms: 2 }),
    2,
  );
}

describe("StudyPanel", () => {
  it("renders a concise empty state", () => {
    const html = renderToStaticMarkup(
      <StudyPanel state={emptyTranscript} />,
    );

    expect(html).toContain("Nothing saved yet");
    expect(html).not.toContain("study-group");
  });

  it("renders distinct cards with their optional learning details", () => {
    let state = emptyTranscript;
    state = addTool(state, "i1", "c1", "note_correction", {
      summary: "Correction saved.",
      detail: {
        type: "correction",
        language: "zh",
        said: "两书",
        correct: "两本书",
        explanation: "Books take the measure word 本.",
        kind: "grammar",
        romanization: "liǎng běn shū",
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
        note: "Use this to encourage someone.",
      },
    });
    state = addTool(state, "i3", "c3", "pronunciation_feedback", {
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

    const html = renderToStaticMarkup(<StudyPanel state={state} />);
    expect(html).toContain("study-card--correction");
    expect(html).toContain("study-card--phrase");
    expect(html).toContain("study-card--pronunciation");
    for (const text of ["两本书", "liǎng běn shū", "加油", "keep going", "hǎo", "pitch dip"]) {
      expect(html).toContain(text);
    }
  });

  it("renders the newest item first within a category", () => {
    let state = emptyTranscript;
    state = addTool(state, "i1", "c1", "save_phrase", {
      summary: "First phrase.",
      detail: { type: "phrase", language: "zh", phrase: "你好", meaning: "hello" },
    });
    state = addTool(state, "i2", "c2", "save_phrase", {
      summary: "Second phrase.",
      detail: { type: "phrase", language: "zh", phrase: "再见", meaning: "goodbye" },
    });

    const html = renderToStaticMarkup(<StudyPanel state={state} />);
    expect(html.indexOf("再见")).toBeLessThan(html.indexOf("你好"));
  });

  it("renders a Han phrase cleanly when no romanization was supplied", () => {
    const state = addTool(emptyTranscript, "i1", "c1", "save_phrase", {
      summary: "Phrase saved.",
      detail: { type: "phrase", language: "zh", phrase: "谢谢", meaning: "thank you" },
    });

    const html = renderToStaticMarkup(<StudyPanel state={state} />);
    expect(html).toContain("谢谢");
    expect(html).not.toContain('class="romanization"');
  });

  it("does not render failed or malformed tool results", () => {
    let state = emptyTranscript;
    state = addTool(state, "i1", "c1", "save_phrase", {
      summary: "Failed phrase.",
      error: "tool_failed",
      detail: { type: "phrase", language: "zh", phrase: "SHOULD_NOT_RENDER", meaning: "x" },
    });
    state = addTool(state, "i2", "c2", "note_correction", {
      summary: "Malformed correction.",
      detail: { type: "correction", language: "zh", correct: "ALSO_HIDDEN" },
    });

    const html = renderToStaticMarkup(<StudyPanel state={state} />);
    expect(html).toContain("Nothing saved yet");
    expect(html).not.toContain("SHOULD_NOT_RENDER");
    expect(html).not.toContain("ALSO_HIDDEN");
  });

  it("offers a clear control only when study data exists", () => {
    const empty = renderToStaticMarkup(
      <StudyPanel state={emptyTranscript} onClear={() => undefined} />,
    );
    const state = addTool(emptyTranscript, "i1", "c1", "save_phrase", {
      summary: "Phrase saved.",
      detail: { type: "phrase", language: "zh", phrase: "加油", meaning: "keep going" },
    });
    const populated = renderToStaticMarkup(
      <StudyPanel state={state} onClear={() => undefined} />,
    );

    expect(empty).not.toContain(">clear</button>");
    expect(populated).toContain(">clear</button>");
  });

  it("can clear a persisted practice language even when there are no cards", () => {
    const state = transcriptFromStudy({
      corrections: [],
      phrases: [],
      pronunciationNotes: [],
      practiceLanguage: {
        type: "practice_language",
        language: "zh",
        level: "beginner",
      },
    });

    const html = renderToStaticMarkup(
      <StudyPanel state={state} onClear={() => undefined} />,
    );

    expect(html).toContain("Nothing saved yet");
    expect(html).toContain(">clear</button>");
  });
});
