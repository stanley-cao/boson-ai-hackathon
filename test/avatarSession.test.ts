import type { Room } from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import { AvatarSession, AvatarUnavailableError } from "../src/livekit/AvatarSession";
import { TOOL_RPC_METHOD } from "../src/livekit/toolRpc";
import type { ConnectionState } from "../src/realtime/RealtimeClient";

const TOKEN = { url: "wss://polyglot.livekit.cloud", room: "polyglot-0123456789ab", identity: "learner-1", token: "jwt" };

/** Records the order of every call the session makes on the room. */
function fakeRoom(calls: string[], participants = ["polyglot-tutor"]) {
  const room = {
    remoteParticipants: new Map(participants.map((identity) => [identity, { identity }])),
    registerRpcMethod: (method: string) => calls.push(`rpc:${method}`),
    unregisterRpcMethod: (method: string) => calls.push(`unrpc:${method}`),
    registerTextStreamHandler: (topic: string) => calls.push(`text:${topic}`),
    unregisterTextStreamHandler: (topic: string) => calls.push(`untext:${topic}`),
    on: () => room,
    off: () => room,
    connect: async () => void calls.push("connect"),
    startAudio: async () => {},
    disconnect: async () => void calls.push("disconnect"),
    localParticipant: {
      setMicrophoneEnabled: async (on: boolean) => void calls.push(`mic:${on}`),
      sendText: async () => {},
    },
  };
  return room as unknown as Room;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function setup(avatarAnswer: () => Response) {
  const calls: string[] = [];
  const states: ConnectionState[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/api/livekit/token") return json(200, TOKEN);
    if (url === "/api/avatar/sessions") return avatarAnswer();
    return json(200, { id: "as_1", status: "terminated" });
  });
  const session = new AvatarSession({
    fetchImpl: fetchImpl as typeof fetch,
    createRoom: () => fakeRoom(calls),
    onConnectionState: (s) => states.push(s),
  });
  return { session, calls, states, fetchImpl };
}

describe("AvatarSession", () => {
  it("answers tools before joining, adds the avatar after, and releases it on leaving", async () => {
    const { session, calls, states, fetchImpl } = setup(() => json(201, { id: "as_1", status: "active" }));

    await session.connect();
    expect(states).toEqual(["connecting", "open"]);
    expect(session.micActive).toBe(true);
    // The room asked for the avatar only once the learner was in it.
    expect(calls).toEqual([
      "POST /api/livekit/token",
      `rpc:${TOOL_RPC_METHOD}`,
      "text:lk.transcription",
      "connect",
      "mic:true",
      "POST /api/avatar/sessions",
    ]);
    const avatarCall = fetchImpl.mock.calls.find(([url]) => url === "/api/avatar/sessions");
    expect(JSON.parse(String(avatarCall?.[1]?.body))).toEqual({ room: TOKEN.room });
    // No choice passed: the server falls back to the default pair.
    const tokenCall = fetchImpl.mock.calls.find(([url]) => url === "/api/livekit/token");
    expect(JSON.parse(String(tokenCall?.[1]?.body))).toEqual({});

    calls.length = 0;
    await session.close();
    expect(calls).toContain("DELETE /api/avatar/sessions/as_1");
    expect(calls).toContain(`unrpc:${TOOL_RPC_METHOD}`);
    expect(calls).toContain("disconnect");
    expect(states.at(-1)).toBe("closed");

    // A second close (StrictMode, or pagehide after leaving) does nothing.
    calls.length = 0;
    await session.close();
    expect(calls).toEqual([]);
  });

  it("asks for a room in the picked language and level", async () => {
    const { session, fetchImpl } = setup(() => json(201, { id: "as_1", status: "active" }));
    await session.connect("ko", "intermediate");
    const tokenCall = fetchImpl.mock.calls.find(([url]) => url === "/api/livekit/token");
    expect(JSON.parse(String(tokenCall?.[1]?.body))).toEqual({ language: "ko", level: "intermediate" });
    await session.close();
  });

  it("leaves without an avatar when no agent joins the room", async () => {
    const calls: string[] = [];
    const states: ConnectionState[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return json(200, TOKEN);
    });
    const session = new AvatarSession({
      fetchImpl: fetchImpl as typeof fetch,
      createRoom: () => fakeRoom(calls, []),
      agentJoinTimeoutMs: 5,
      onConnectionState: (s) => states.push(s),
    });

    const error = await session.connect().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "agent_not_running" });
    // The avatar was never created, so no slot is held.
    expect(calls).not.toContain("POST /api/avatar/sessions");
    expect(calls).toContain("disconnect");
    expect(states).toEqual(["connecting", "closed"]);
  });

  it("leaves the room and reports the code when the avatar has no capacity", async () => {
    const { session, calls, states } = setup(() =>
      json(503, { error: "capacity_exhausted" }, { "Retry-After": "30" }),
    );

    const error = await session.connect().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AvatarUnavailableError);
    expect(error).toMatchObject({ code: "capacity_exhausted", retryAfter: "30" });
    expect(calls).toContain("disconnect");
    // No session was created, so there is nothing to release.
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false);
    // Never "open": a failed attempt must not show the session recap.
    expect(states).toEqual(["connecting", "closed"]);
    expect(session.micActive).toBe(false);
  });

  it("can be left while the avatar is being created, and still releases it", async () => {
    let session!: AvatarSession;
    // The learner presses Disconnect while Boson is still creating the avatar.
    const ctx = setup(() => {
      session.disconnect();
      return json(201, { id: "as_late", status: "active" });
    });
    session = ctx.session;

    // Resolves quietly: a cancel is not "avatar unavailable".
    await expect(session.connect()).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctx.calls).toContain("disconnect");
    expect(ctx.calls).toContain("DELETE /api/avatar/sessions/as_late");
    expect(ctx.states).toEqual(["connecting", "closing", "closed"]);
  });

  it("skips the remaining steps when left before joining the room", async () => {
    const calls: string[] = [];
    let session!: AvatarSession;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(`POST ${String(input)}`);
      session.disconnect();
      return json(200, TOKEN);
    });
    session = new AvatarSession({ fetchImpl: fetchImpl as typeof fetch, createRoom: () => fakeRoom(calls) });

    await expect(session.connect()).resolves.toBeUndefined();
    expect(calls).not.toContain("connect");
    expect(calls).not.toContain("POST /api/avatar/sessions");
    expect(session.connectionState).toBe("closed");
  });

  it("reports a token server without LiveKit the same way", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async () => json(500, { error: "livekit_not_configured" }));
    const session = new AvatarSession({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      createRoom: () => fakeRoom(calls),
    });

    await expect(session.connect()).rejects.toMatchObject({ code: "livekit_not_configured" });
    expect(calls).not.toContain("connect");
    expect(session.connectionState).toBe("closed");
  });
});
