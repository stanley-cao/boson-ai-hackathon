import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "../src/realtime/events";
import { emptyStudyState, studyFromTranscript, transcriptFromStudy } from "../src/state/study";
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
  at = 1,
): TranscriptState {
  const pending = transcriptReducer(
    state,
    evt({
      type: "response.output_item.added",
      item: { id: itemId, type: "function_call", name, call_id: callId },
    }),
    at,
  );
  return transcriptReducer(
    pending,
    evt({ type: CLIENT_TOOL_RESULT, call_id: callId, result, ms: 2 }),
    at + 1,
  );
}

function phraseResult(phrase: string) {
  return {
    summary: "Phrase saved.",
    detail: { type: "phrase", language: "zh", phrase, meaning: `${phrase} meaning` },
  };
}

describe("SessionRecap", () => {
  it("opens only when a session that reached open disconnects", () => {
    const failed = recapVisibilityAfterConnection(INITIAL_RECAP_VISIBILITY, "closed", 5);
    expect(failed.visible).toBe(false);

    const opened = recapVisibilityAfterConnection(INITIAL_RECAP_VISIBILITY, "open", 10);
    const closing = recapVisibilityAfterConnection(opened, "closing", 20);
    const closed = recapVisibilityAfterConnection(closing, "closed", 30);

    expect(closing.visible).toBe(false);
    expect(closed).toEqual({ sessionOpened: false, visible: true, openedAt: 10 });
  });

  it("renders zero counts and useful empty states", () => {
    const html = renderToStaticMarkup(
      <SessionRecap state={emptyTranscript} openedAt={0} onContinue={() => undefined} />,
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
      <SessionRecap state={state} openedAt={0} onContinue={() => undefined} />,
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
      <SessionRecap state={state} openedAt={0} onContinue={() => undefined} />,
    );

    expect(html).not.toContain("HIDDEN");
    expect(html).not.toContain("ALSO_HIDDEN");
    expect(html.match(/<strong>0<\/strong>/g)).toHaveLength(3);
  });

  it("leaves out notes restored from storage, which the study panel still has", () => {
    const saved = {
      ...emptyStudyState(),
      phrases: [
        { type: "phrase" as const, language: "zh" as const, phrase: "旧的", meaning: "old" },
      ],
    };
    const state = addTool(transcriptFromStudy(saved), "p1", "call-1", "save_phrase", phraseResult("新的"), 100);

    // openedAt 0 as well, so the restored flag alone is enough to exclude them.
    for (const openedAt of [0, 50]) {
      const html = renderToStaticMarkup(
        <SessionRecap state={state} openedAt={openedAt} onContinue={() => undefined} />,
      );
      expect(html, String(openedAt)).toContain("You collected 1 study note to revisit.");
      expect(html).toContain("新的");
      expect(html).not.toContain("旧的");
    }
    expect(studyFromTranscript(state).phrases.map((p) => p.phrase)).toEqual(["旧的", "新的"]);
  });

  it("counts only the second session's notes after a reconnect on the same page", () => {
    let visibility = recapVisibilityAfterConnection(INITIAL_RECAP_VISIBILITY, "open", 10);
    let state = addTool(emptyTranscript, "p1", "call-1", "save_phrase", phraseResult("第一"), 20);
    visibility = recapVisibilityAfterConnection(visibility, "closed", 30);
    visibility = recapVisibilityAfterConnection(visibility, "open", 40);
    state = addTool(state, "p2", "call-2", "save_phrase", phraseResult("第二"), 50);
    visibility = recapVisibilityAfterConnection(visibility, "closed", 60);

    const html = renderToStaticMarkup(
      <SessionRecap state={state} openedAt={visibility.openedAt} onContinue={() => undefined} />,
    );
    expect(html).toContain("You collected 1 study note to revisit.");
    expect(html).toContain("第二");
    expect(html).not.toContain("第一");
  });

  it("shows the empty message for a session that saved nothing, even with earlier notes", () => {
    const saved = {
      ...emptyStudyState(),
      phrases: [
        { type: "phrase" as const, language: "zh" as const, phrase: "旧的", meaning: "old" },
      ],
    };
    const state = addTool(transcriptFromStudy(saved), "p1", "call-1", "save_phrase", phraseResult("早的"), 20);

    const html = renderToStaticMarkup(
      <SessionRecap state={state} openedAt={40} onContinue={() => undefined} />,
    );
    expect(html).toContain("No study notes were saved.");
    expect(html).toContain("No phrases were saved this session.");
    expect(html.match(/<strong>0<\/strong>/g)).toHaveLength(3);
  });
});
