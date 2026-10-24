import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  TOOL_RPC_METHOD,
  answerToolRpc,
  registerToolRpc,
  type ToolRpcParticipant,
} from "../src/livekit/toolRpc";
import type { ServerEvent } from "../src/realtime/events";
import { studyFromTranscript } from "../src/state/study";
import {
  emptyTranscript,
  toList,
  transcriptReducer,
  type TranscriptState,
} from "../src/state/transcriptStore";
import { handlers } from "../src/tools/handlers";
import { runTool } from "../src/tools/registry";

const phraseCall = {
  call_id: "call_1",
  name: "save_phrase",
  arguments: { language: "zh", phrase: "加油", meaning: "keep going", romanization: "jiā yóu" },
};

/** Run a payload through the handler, collecting what reaches the transcript. */
async function answer(payload: string) {
  const events: ServerEvent[] = [];
  const response = JSON.parse(await answerToolRpc(payload, (evt) => events.push(evt)));
  const state = events.reduce<TranscriptState>((s, evt) => transcriptReducer(s, evt, 1), emptyTranscript);
  return { response, events, state };
}

describe("tool calls over LiveKit RPC", () => {
  it("runs the forwarded call and fills the study panel as the WebSocket path does", async () => {
    const { response, state } = await answer(JSON.stringify(phraseCall));

    expect(response.error).toBeUndefined();
    expect(response.detail).toMatchObject({ type: "phrase", phrase: "加油", romanization: "jiā yóu" });
    const [item] = toList(state);
    expect(item).toMatchObject({ kind: "tool", callId: "call_1", name: "save_phrase", status: "ok" });
    expect(item.kind === "tool" && item.args).toEqual(phraseCall.arguments);
    expect(studyFromTranscript(state).phrases.map((p) => p.phrase)).toEqual(["加油"]);
  });

  it("answers an unknown tool with an error result instead of throwing", async () => {
    const { response, state } = await answer(JSON.stringify({ ...phraseCall, name: "web_search" }));

    expect(response.error).toBe("unknown_tool");
    expect(toList(state)[0]).toMatchObject({ kind: "tool", status: "error" });
  });

  it("answers a payload it can't read, without touching the transcript", async () => {
    for (const payload of ["not json", "null", "[]", JSON.stringify({ name: "save_phrase" })]) {
      const { response, events } = await answer(payload);
      expect(response.error, payload).toBe("bad_request");
      expect(typeof response.summary).toBe("string");
      expect(events).toEqual([]);
    }
  });

  it("runs a call whose arguments aren't an object with none, so the handler complains", async () => {
    const { response } = await answer(JSON.stringify({ ...phraseCall, arguments: "加油" }));
    expect(response.error).toBe("unknown_language");
  });

  it("registers the method and stops answering when unregistered", async () => {
    const registered = new Map<string, (data: { payload: string }) => Promise<string>>();
    const participant: ToolRpcParticipant = {
      registerRpcMethod: (method, handler) => void registered.set(method, handler),
      unregisterRpcMethod: (method) => void registered.delete(method),
    };
    const events: ServerEvent[] = [];
    const stop = registerToolRpc(participant, (evt) => events.push(evt));

    const response = await registered.get(TOOL_RPC_METHOD)!({ payload: JSON.stringify(phraseCall) });
    expect(JSON.parse(response).detail.phrase).toBe("加油");
    expect(events).toHaveLength(2);

    stop();
    expect(registered.has(TOOL_RPC_METHOD)).toBe(false);
  });

  it("uses the method name the agent calls", () => {
    // livekit/tools.py is Python, so the shared name is checked by reading it.
    const agent = readFileSync(new URL("../livekit/tools.py", import.meta.url), "utf8");
    expect(agent).toContain(`TOOL_RPC_METHOD = "${TOOL_RPC_METHOD}"`);
  });
});

describe("runTool", () => {
  afterEach(() => {
    delete handlers.throws_for_test;
  });

  it("answers with tool_failed when a handler throws, and reports the error", async () => {
    handlers.throws_for_test = () => {
      throw new Error("boom");
    };
    const errors: unknown[] = [];
    const result = await runTool("throws_for_test", {}, (e) => errors.push(e));

    expect(result).toEqual({ summary: "That lookup failed.", error: "tool_failed" });
    expect((errors[0] as Error).message).toBe("boom");
  });
});
