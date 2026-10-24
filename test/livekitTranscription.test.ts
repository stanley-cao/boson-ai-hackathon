import { describe, expect, it } from "vitest";
import {
  activityFromAgentState,
  readTranscription,
  type TranscriptionStream,
} from "../src/livekit/transcription";
import type { ServerEvent } from "../src/realtime/events";
import {
  emptyTranscript,
  toList,
  transcriptReducer,
  type TranscriptState,
} from "../src/state/transcriptStore";

/** A text stream that yields `chunks`, then optionally breaks off. */
function stream(
  segment: string,
  chunks: string[],
  { final = false, breakOff = false } = {},
): TranscriptionStream {
  return {
    info: { id: `TS_${segment}`, attributes: { "lk.segment_id": segment, "lk.transcription_final": String(final) } },
    async *[Symbol.asyncIterator]() {
      yield* chunks;
      if (breakOff) throw new Error("sender left");
    },
  };
}

/** Feed streams in order, as the room would, and reduce what they emit. */
async function feed(streams: [TranscriptionStream, boolean][]): Promise<TranscriptState> {
  const events: ServerEvent[] = [];
  for (const [s, fromLearner] of streams) await readTranscription(s, fromLearner, (e) => events.push(e));
  return events.reduce<TranscriptState>((st, e) => transcriptReducer(st, e, 1), emptyTranscript);
}

describe("LiveKit transcription streams", () => {
  it("turns the learner's interim then final transcript into one user turn", async () => {
    const state = await feed([
      [stream("SG_u1", ["저는"]), true],
      [stream("SG_u1", ["저는 학생이에요."], { final: true }), true],
    ]);
    expect(toList(state)).toMatchObject([
      { kind: "user", itemId: "lk-SG_u1", text: "저는 학생이에요.", status: "complete" },
    ]);
  });

  it("leaves an interim learner turn pending", async () => {
    const state = await feed([[stream("SG_u1", ["저는"]), true]]);
    expect(toList(state)).toMatchObject([{ kind: "user", text: null, status: "pending" }]);
  });

  it("streams the tutor's deltas into one completed turn", async () => {
    const state = await feed([[stream("SG_a1", ["Bonjour", " ! Ça va ?"]), false]]);
    expect(toList(state)).toMatchObject([
      { kind: "assistant", itemId: "lk-SG_a1", text: "Bonjour ! Ça va ?", status: "complete" },
    ]);
  });

  it("prefers a final tutor stream's full text over the joined deltas", async () => {
    const state = await feed([
      [stream("SG_a1", ["Hello", "there friend"]), false],
      [stream("SG_a1", ["Hello there"], { final: true }), false],
    ]);
    expect(toList(state)).toMatchObject([{ kind: "assistant", text: "Hello there", status: "complete" }]);
  });

  it("creates the tutor turn from a final stream alone", async () => {
    const state = await feed([[stream("SG_a1", ["안녕하세요"], { final: true }), false]]);
    expect(toList(state)).toMatchObject([{ kind: "assistant", text: "안녕하세요", status: "complete" }]);
  });

  it("marks a tutor turn interrupted when the learner speaks over it", async () => {
    const events: ServerEvent[] = [];
    const emit = (e: ServerEvent) => events.push(e);
    // The tutor's stream is still open when the learner's arrives.
    let finishTutor!: () => void;
    const tutor: TranscriptionStream = {
      info: { id: "TS_a1", attributes: { "lk.segment_id": "SG_a1" } },
      async *[Symbol.asyncIterator]() {
        yield "Let me explain";
        await new Promise<void>((resolve) => (finishTutor = resolve));
      },
    };
    const tutorDone = readTranscription(tutor, false, emit);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await readTranscription(stream("SG_u1", ["wait"], { final: true }), true, emit);
    finishTutor();
    await tutorDone;

    const state = events.reduce<TranscriptState>((st, e) => transcriptReducer(st, e, 1), emptyTranscript);
    expect(toList(state)).toMatchObject([
      { kind: "assistant", text: "Let me explain", status: "interrupted" },
      { kind: "user", text: "wait", status: "complete" },
    ]);
  });

  it("keeps what arrived when a stream breaks off, and still ends the turn", async () => {
    const state = await feed([[stream("SG_a1", ["Très"], { breakOff: true }), false]]);
    expect(toList(state)).toMatchObject([{ kind: "assistant", text: "Très", status: "complete" }]);
  });

  it("falls back to the stream id when there is no segment id", async () => {
    const s: TranscriptionStream = {
      info: { id: "TS_x" },
      async *[Symbol.asyncIterator]() {
        yield "Hi";
      },
    };
    const state = await feed([[s, false]]);
    expect(toList(state)[0]).toMatchObject({ itemId: "lk-TS_x", text: "Hi" });
  });
});

describe("activityFromAgentState", () => {
  it("passes through the states the status bar shows", () => {
    expect(activityFromAgentState("listening")).toBe("listening");
    expect(activityFromAgentState("thinking")).toBe("thinking");
    expect(activityFromAgentState("speaking")).toBe("speaking");
  });

  it("treats anything else as idle", () => {
    expect(activityFromAgentState("initializing")).toBe("idle");
    expect(activityFromAgentState(undefined)).toBe("idle");
    expect(activityFromAgentState("dancing")).toBe("idle");
  });
});
