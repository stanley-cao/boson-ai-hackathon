import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../src/realtime/events";
import {
  CLIENT_TOOL_RESULT,
  emptyTranscript,
  transcriptReducer,
  type TranscriptState,
} from "../src/state/transcriptStore";
import {
  INITIAL_RECAP_VISIBILITY,
  SessionRecap,
  recapVisibilityAfterConnection,
} from "../src/ui/SessionRecap";

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

describe("SessionRecap", () => {
  it("opens only when a session that reached open disconnects", () => {
    const failed = recapVisibilityAfterConnection(INITIAL_RECAP_VISIBILITY, "closed");
    expect(failed.visible).toBe(false);

    const opened = recapVisibilityAfterConnection(INITIAL_RECAP_VISIBILITY, "open");
    const closing = recapVisibilityAfterConnection(opened, "closing");
    const closed = recapVisibilityAfterConnection(closing, "closed");

    expect(closing.visible).toBe(false);
    expect(closed).toEqual({ sessionOpened: false, visible: true });
  });

  it("renders zero counts and useful empty states", () => {
    const html = renderToStaticMarkup(
      <SessionRecap state={emptyTranscript} onContinue={() => undefined} />,
    );

    expect(html).toContain("Session complete");
    expect(html).toContain("Here’s what you covered");
    expect(html.match(/<strong>0<\/strong>/g)).toHaveLength(3);
    expect(html).toContain("No corrections were saved this session.");
    expect(html).toContain("No phrases were saved this session.");
    expect(html).toContain("Back to conversation");
  });

  it("shows counts, corrections, and phrases newest first", () => {
    let state = emptyTranscript;
    state = addTool(state, "c1", "call-1", "note_correction", {
      summary: "Correction saved.",
      detail: {
        type: "correction",
        language: "zh",
        said: "两书",
        correct: "两本书",
        explanation: "Use the measure word 本.",
        kind: "grammar",
        romanization: "liǎng běn shū",
      },
    });
    state = addTool(state, "c2", "call-2", "note_correction", {
      summary: "Correction saved.",
      detail: {
        type: "correction",
        language: "zh",
        said: "我昨天去商店",
        correct: "我昨天去了商店",
        explanation: "Use 了 for the completed action.",
        kind: "grammar",
      },
    });
    state = addTool(state, "p1", "call-3", "save_phrase", {
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
    state = addTool(state, "p2", "call-4", "save_phrase", {
      summary: "Phrase saved.",
      detail: { type: "phrase", language: "zh", phrase: "再见", meaning: "goodbye" },
    });
    state = addTool(state, "n1", "call-5", "pronunciation_feedback", {
      summary: "Pronunciation note saved.",
      detail: {
        type: "pronunciation",
        language: "zh",
        target: "好",
        issue: "tone",
        tip: "Dip, then rise.",
      },
    });

    const html = renderToStaticMarkup(
      <SessionRecap state={state} onContinue={() => undefined} />,
    );

    expect(html).toContain("You collected 5 study notes to revisit.");
    expect(html).toContain("<strong>2</strong><span>Corrections</span>");
    expect(html).toContain("<strong>2</strong><span>Phrases</span>");
    expect(html).toContain("<strong>1</strong><span>Pronunciation tips</span>");
    expect(html.indexOf("我昨天去了商店")).toBeLessThan(html.indexOf("两本书"));
    expect(html.indexOf("再见")).toBeLessThan(html.indexOf("加油"));
    for (const text of ["liǎng běn shū", "keep going", "jiā yóu", "encourage someone"]) {
      expect(html).toContain(text);
    }
  });

  it("ignores failed and malformed tool results", () => {
    let state = emptyTranscript;
    state = addTool(state, "p1", "call-1", "save_phrase", {
      summary: "Failed.",
      error: "tool_failed",
      detail: { type: "phrase", language: "zh", phrase: "HIDDEN", meaning: "x" },
    });
    state = addTool(state, "c1", "call-2", "note_correction", {
      summary: "Malformed.",
      detail: { type: "correction", language: "zh", correct: "ALSO_HIDDEN" },
    });

    const html = renderToStaticMarkup(
      <SessionRecap state={state} onContinue={() => undefined} />,
    );

    expect(html).not.toContain("HIDDEN");
    expect(html).not.toContain("ALSO_HIDDEN");
    expect(html.match(/<strong>0<\/strong>/g)).toHaveLength(3);
  });
});
