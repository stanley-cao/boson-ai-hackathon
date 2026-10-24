import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { TokenVerifier } from "livekit-server-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_IDENTITY, AVATAR_IDENTITY } from "./avatar";
import { createApp } from "./index";

const LIVEKIT = { url: "wss://polyglot-test.livekit.cloud", apiKey: "lk-key", apiSecret: "s".repeat(32) };
const verifier = new TokenVerifier(LIVEKIT.apiKey, LIVEKIT.apiSecret);
const ROOM = "polyglot-0123456789ab";
const SESSION = {
  id: "avrt_3f9c2a7e8b1d4c6f",
  object: "avatar.realtime.session",
  status: "active",
  model: "higgs-avatar",
  avatar_id: "builtin_claire_v1",
  avatar_identity: AVATAR_IDENTITY,
  created_at: "2026-10-24T10:00:00Z",
  expires_at: "2026-10-24T10:15:00Z",
  ended_at: null,
};

const servers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    ),
  );
});

async function start(options: Parameters<typeof createApp>[0]): Promise<string> {
  const server = createApp({
    apiKey: "server-secret",
    baseUrl: "https://boson.test",
    livekit: LIVEKIT,
    avatarMaxDurationSeconds: 900,
    sleep: async () => {},
    ...options,
  }).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function bosonError(status: number, code: string, headers: Record<string, string> = {}) {
  return json({ error: { message: code, type: "error", code, param: null } }, status, headers);
}

function createSession(base: string, room = ROOM) {
  return fetch(`${base}/api/avatar/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room }),
  });
}

interface LearnerToken {
  url: string;
  room: string;
  identity: string;
  token: string;
}

async function learnerToken(base: string, choice?: unknown): Promise<{ status: number; body: LearnerToken }> {
  const response = await fetch(`${base}/api/livekit/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(choice ?? {}),
  });
  return { status: response.status, body: (await response.json()) as LearnerToken };
}

describe("POST /api/livekit/token", () => {
  it("mints a short-lived learner token for a fresh room", async () => {
    const base = await start({ fetchImpl: vi.fn<typeof fetch>() });
    const { status, body } = await learnerToken(base);

    expect(status).toBe(200);
    expect(body.url).toBe(LIVEKIT.url);
    expect(body.room).toMatch(/^polyglot-[0-9a-f]{12}$/);
    const claims = await verifier.verify(body.token);
    expect(claims.sub).toBe(body.identity);
    expect(body.identity).toMatch(/^learner-/);
    expect(claims.exp! - claims.nbf!).toBe(600);
    expect(claims.video).toEqual({
      roomJoin: true,
      room: body.room,
      canPublishSources: ["microphone"],
      canSubscribe: true,
      canPublishData: true,
    });
  });

  it("tells the agent the learner's language and level", async () => {
    const base = await start({ fetchImpl: vi.fn<typeof fetch>() });
    const { body } = await learnerToken(base, { language: "ko", level: "advanced" });
    const claims = await verifier.verify(body.token);
    // "advanced" shares the intermediate prompt (learnerLevelFor).
    expect(JSON.parse(claims.metadata!)).toEqual({ language: "ko", level: "intermediate", activity: "conversation", reviewItems: [] });
  });

  it("falls back to the default pair for an unknown or missing choice", async () => {
    const base = await start({ fetchImpl: vi.fn<typeof fetch>() });
    for (const choice of [{ language: "xx", level: 3 }, {}]) {
      const claims = await verifier.verify((await learnerToken(base, choice)).body.token);
      expect(JSON.parse(claims.metadata!)).toEqual({ language: "zh", level: "beginner", activity: "conversation", reviewItems: [] });
    }
  });

  it("validates and caps quiz review metadata", async () => {
    const base = await start({ fetchImpl: vi.fn<typeof fetch>() });
    const reviewItems = Array.from({ length: 8 }, (_, i) => ({
      kind: i === 0 ? "correction" : "phrase",
      prompt: ` prompt ${i} `,
      answer: "a".repeat(200),
    }));
    const { body } = await learnerToken(base, { activity: "quiz", reviewItems });
    const claims = await verifier.verify(body.token);
    const metadata = JSON.parse(claims.metadata!);
    expect(metadata.activity).toBe("quiz");
    expect(metadata.reviewItems).toHaveLength(5);
    expect(metadata.reviewItems[0].answer).toHaveLength(160);
  });

  it("gives every request its own room", async () => {
    const base = await start({ fetchImpl: vi.fn<typeof fetch>() });
    const rooms = await Promise.all([1, 2].map(async () => (await learnerToken(base)).body.room));
    expect(rooms[0]).not.toBe(rooms[1]);
  });

  it("answers 500 without LiveKit keys", async () => {
    const base = await start({ livekit: null, fetchImpl: vi.fn<typeof fetch>() });
    const response = await fetch(`${base}/api/livekit/token`, { method: "POST" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "livekit_not_configured" });
  });
});

describe("POST /api/avatar/sessions", () => {
  it("adds the avatar to the room, listening to the agent", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(json(SESSION, 201));
    const base = await start({ fetchImpl: upstream });

    const response = await createSession(base);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: SESSION.id,
      status: "active",
      expires_at: SESSION.expires_at,
      ended_at: null,
    });

    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("https://boson.test/v1/avatar/sessions");
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: "Bearer server-secret" } });
    const sent = JSON.parse(String(init?.body));
    expect(sent).toMatchObject({
      avatar_id: "builtin_claire_v1",
      max_duration_seconds: 900,
      transport: {
        type: "livekit",
        url: LIVEKIT.url,
        room_name: ROOM,
        participant_identity: AVATAR_IDENTITY,
        publisher_identity: AGENT_IDENTITY,
      },
    });

    // The avatar's token: its identity, publish rights, and a TTL past the session.
    const claims = await verifier.verify(sent.transport.participant_token);
    expect(claims.sub).toBe(AVATAR_IDENTITY);
    expect(claims.exp! - claims.nbf!).toBeGreaterThan(900);
    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: ROOM,
      canPublishSources: ["camera", "microphone"],
      canPublishData: true,
    });
  });

  it("refuses a room this server didn't name, without calling Boson", async () => {
    const upstream = vi.fn<typeof fetch>();
    const base = await start({ fetchImpl: upstream });
    for (const room of ["", "someone-elses-room", "polyglot-../x"]) {
      const response = await createSession(base, room);
      expect(response.status, room).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("waits Retry-After and retries when capacity is exhausted", async () => {
    const sleep = vi.fn(async () => {});
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(bosonError(429, "capacity_exhausted", { "Retry-After": "2" }))
      .mockResolvedValueOnce(bosonError(503, "service_unavailable", { "Retry-After": "1" }))
      .mockResolvedValueOnce(json(SESSION, 201));
    const base = await start({ fetchImpl: upstream, sleep });

    const response = await createSession(base);
    expect(response.status).toBe(201);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[2000], [1000]]);
  });

  it("backs off and retries a rate limit that gives no Retry-After", async () => {
    const sleep = vi.fn(async () => {});
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(bosonError(429, "rate_limit_exceeded"))
      .mockResolvedValueOnce(json(SESSION, 201));
    const base = await start({ fetchImpl: upstream, sleep });

    expect((await createSession(base)).status).toBe(201);
    expect(sleep.mock.calls).toEqual([[1000]]);
  });

  it("passes a long wait back to the browser with Retry-After instead of holding the request", async () => {
    const sleep = vi.fn(async () => {});
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(bosonError(429, "capacity_exhausted", { "Retry-After": "60" }));
    const base = await start({ fetchImpl: upstream, sleep });

    const response = await createSession(base);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ error: "capacity_exhausted" });
    expect(upstream).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after three attempts", async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () =>
      bosonError(429, "capacity_exhausted", { "Retry-After": "1" }),
    );
    const base = await start({ fetchImpl: upstream });

    const response = await createSession(base);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("doesn't retry errors that waiting won't fix", async () => {
    for (const [status, code] of [
      [429, "insufficient_quota"],
      [422, "invalid_livekit_url"],
      [404, "avatar_not_found"],
    ] as const) {
      const upstream = vi.fn<typeof fetch>().mockResolvedValue(bosonError(status, code));
      const base = await start({ fetchImpl: upstream });
      const response = await createSession(base);
      expect(response.status, code).toBe(status);
      expect(await response.json()).toEqual({ error: code });
      expect(upstream).toHaveBeenCalledOnce();
    }
  });

  it("doesn't retry a network error, since the avatar may already be in the room", async () => {
    const upstream = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    const base = await start({ fetchImpl: upstream });

    const response = await createSession(base);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "avatar_unavailable" });
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("answers 500 without a Boson key or LiveKit keys", async () => {
    for (const options of [{ apiKey: "" }, { livekit: null }]) {
      const upstream = vi.fn<typeof fetch>();
      const base = await start({ fetchImpl: upstream, ...options });
      expect((await createSession(base)).status).toBe(500);
      expect(upstream).not.toHaveBeenCalled();
    }
  });
});

describe("GET and DELETE /api/avatar/sessions/:id", () => {
  it("reads and releases a session this server created", async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(SESSION, 201))
      .mockResolvedValueOnce(json(SESSION))
      .mockResolvedValueOnce(json({ ...SESSION, status: "terminated", ended_at: "2026-10-24T10:03:00Z" }));
    const base = await start({ fetchImpl: upstream });
    await createSession(base);

    const read = await fetch(`${base}/api/avatar/sessions/${SESSION.id}`);
    expect(await read.json()).toMatchObject({ status: "active" });

    const released = await fetch(`${base}/api/avatar/sessions/${SESSION.id}`, { method: "DELETE" });
    expect(await released.json()).toMatchObject({ status: "terminated", ended_at: "2026-10-24T10:03:00Z" });
    expect(upstream.mock.calls[2][0]).toBe(`https://boson.test/v1/avatar/sessions/${SESSION.id}`);
    expect(upstream.mock.calls[2][1]).toMatchObject({ method: "DELETE" });
  });

  it("retries a release that was rate limited, so the slot is still freed", async () => {
    // Seen live: a DELETE right after create and GET got 429 rate_limit_exceeded.
    const sleep = vi.fn(async () => {});
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(SESSION, 201))
      .mockResolvedValueOnce(bosonError(429, "rate_limit_exceeded"))
      .mockResolvedValueOnce(bosonError(429, "rate_limit_exceeded"))
      .mockResolvedValueOnce(json({ ...SESSION, status: "terminated" }));
    const base = await start({ fetchImpl: upstream, sleep });
    await createSession(base);

    const released = await fetch(`${base}/api/avatar/sessions/${SESSION.id}`, { method: "DELETE" });
    expect(released.status).toBe(200);
    expect(await released.json()).toMatchObject({ status: "terminated" });
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it("won't touch a session it didn't create", async () => {
    const upstream = vi.fn<typeof fetch>();
    const base = await start({ fetchImpl: upstream });
    expect((await fetch(`${base}/api/avatar/sessions/avrt_other`)).status).toBe(404);
    expect((await fetch(`${base}/api/avatar/sessions/avrt_other`, { method: "DELETE" })).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("the agent's identity", () => {
  it("matches the identity livekit/agent.py joins as", () => {
    // The agent is Python, so the shared identity is checked by reading it.
    const agent = readFileSync(new URL("../livekit/agent.py", import.meta.url), "utf8");
    expect(agent).toContain(`AGENT_IDENTITY = "${AGENT_IDENTITY}"`);
  });
});
