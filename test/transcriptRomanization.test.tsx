import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../src/realtime/events";
import {
  CLIENT_TOOL_RESULT,
  emptyTranscript,
  transcriptReducer,
  type TranscriptState,
} from "../src/state/transcriptStore";
import { TranscriptPanel } from "../src/ui/TranscriptPanel";

const evt = (event: Record<string, unknown>) => event as ServerEvent;

function assistantTurn(state: TranscriptState, itemId: string, text: string): TranscriptState {
  let next = transcriptReducer(
    state,
    evt({
      type: "response.output_item.added",
      item: { id: itemId, type: "message", role: "assistant" },
    }),
    1,
  );
  next = transcriptReducer(
    next,
    evt({ type: "response.output_audio_transcript.done", item_id: itemId, transcript: text }),
    2,
  );
  return next;
}

function correctionResult(state: TranscriptState, romanization?: string): TranscriptState {
  let next = transcriptReducer(
    state,
    evt({
      type: "response.output_item.added",
      item: { id: "tool-1", type: "function_call", name: "note_correction", call_id: "c1" },
    }),
    3,
  );
  next = transcriptReducer(
    next,
    evt({
      type: CLIENT_TOOL_RESULT,
      call_id: "c1",
      result: {
        summary: "Correction saved.",
        detail: {
          type: "correction",
          language: "zh",
          said: "两书",
          correct: "两本书",
          explanation: "Use the measure word 本.",
          kind: "grammar",
          ...(romanization ? { romanization } : {}),
        },
      },
      ms: 2,
    }),
    4,
  );
  return next;
}

describe("TranscriptPanel romanization", () => {
  it("shows tool-supplied pinyin under matching Han text", () => {
    let state = assistantTurn(emptyTranscript, "a1", "Say 两本书 slowly.");
    state = correctionResult(state, "liǎng běn shū");

    const html = renderToStaticMarkup(<TranscriptPanel state={state} />);
    expect(html).toContain('class="romanized-text"');
    expect(html).toContain("两本书");
    expect(html).toContain("liǎng běn shū");
    expect(html.indexOf("两本书")).toBeLessThan(html.indexOf("liǎng běn shū"));
  });

  it("renders Han text normally when the tool supplied no pinyin", () => {
    let state = assistantTurn(emptyTranscript, "a1", "Say 两本书 slowly.");
    state = correctionResult(state);

    const html = renderToStaticMarkup(<TranscriptPanel state={state} />);
    expect(html).toContain('class="script-han"');
    expect(html).toContain("两本书");
    expect(html).not.toContain("romanized-text");
    expect(html).not.toContain("transcript-romanization");
  });
});
