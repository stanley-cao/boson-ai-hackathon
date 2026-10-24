import { randomBytes } from "node:crypto";
import { Router, type Response as ExpressResponse } from "express";
import { AccessToken, TrackSource, type VideoGrant } from "livekit-server-sdk";
import { ACTIVE_PAIR, TARGET_LANGUAGE_CODES, learnerLevelFor, type TargetLanguageCode } from "../src/lang/profiles";

/**
 * LiveKit rooms and Higgs Avatar realtime sessions (#33).
 *
 * The avatar only runs inside a LiveKit Cloud room. The learner joins with a
 * token from here, which dispatches the agent (livekit/agent.py) into the
 * room; once the learner is in, the browser asks for an avatar, and Boson adds
 * it to the room. Media never passes through this server or Boson's session
 * routes: the agent sends its speech to the avatar over a LiveKit data stream
 * (#34). https://docs.boson.ai/models/higgs-avatar/realtime-sessions.md
 *
 * If realtime avatars are unavailable (capacity, `not_configured`), the
 * browser keeps direct-WebSocket mode (#35). The documented contingency is
 * pre-rendered clips from POST /v1/videos/stream, which needs no room.
 */

/**
 * The agent joins every room as this identity (livekit/agent.py), so a session
 * can name it as `publisher_identity`: the avatar only plays audio from there.
 * LiveKit mints the agent's own token when it dispatches the worker.
 */
export const AGENT_IDENTITY = "polyglot-tutor";
export const AVATAR_IDENTITY = "polyglot-avatar";
const ROOM_PREFIX = "polyglot-";
const ROOM_NAME = /^polyglot-[0-9a-f]{12}$/;

// The browser's token only has to be valid when it connects.
const LEARNER_TOKEN_TTL_SECONDS = 600;
// The avatar's token must outlast the session (docs: "TTL longer than the session").
const AVATAR_TOKEN_SLACK_SECONDS = 600;
// Answers meaning "nothing happened, try again shortly", so a retry is safe
// even for creation. Retried here only when the wait is short; longer ones go
// back to the browser, which can fall back to direct-WebSocket mode instead.
// Rate limits came back with no Retry-After in live runs, hence the backoff.
const RETRYABLE_CODES = new Set(["capacity_exhausted", "service_unavailable", "rate_limit_exceeded"]);
const MAX_RETRY_WAIT_SECONDS = 10;
const MAX_ATTEMPTS = 3;

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export interface AvatarOptions {
  apiKey?: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  livekit?: LiveKitConfig | null;
  avatarId: string;
  maxDurationSeconds: number;
  sleep?: (ms: number) => Promise<void>;
}

export function loadLiveKitConfig(env = process.env): LiveKitConfig | undefined {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : undefined;
}

function randomId(): string {
  return randomBytes(6).toString("hex");
}

/** Seconds to wait from a Retry-After header, or null if it isn't a number of seconds. */
function retryAfterSeconds(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}

/** The `code` (or failing that, `type`) of a Boson error body. */
function upstreamErrorCode(text: string): string | undefined {
  try {
    const error = (JSON.parse(text) as { error?: { code?: unknown; type?: unknown } }).error;
    if (typeof error?.code === "string") return error.code;
    if (typeof error?.type === "string") return error.type;
  } catch {
    /* not JSON */
  }
  return undefined;
}

/** A target language code from the browser, or the default pair's. */
function targetLanguageFor(value: unknown): TargetLanguageCode {
  return TARGET_LANGUAGE_CODES.find((code) => code === value) ?? ACTIVE_PAIR.target;
}

/** What the browser needs from a session; the rest stays here. */
function sessionView(session: Record<string, unknown>) {
  return {
    id: session.id,
    status: session.status,
    expires_at: session.expires_at,
    ended_at: session.ended_at ?? null,
  };
}

export function avatarRouter({
  apiKey,
  baseUrl,
  fetchImpl,
  livekit,
  avatarId,
  maxDurationSeconds,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: AvatarOptions): Router {
  const router = Router();
  // Only sessions this server created can be read or released through it.
  const sessions = new Set<string>();

  async function token(lk: LiveKitConfig, identity: string, ttlSeconds: number, grant: VideoGrant, metadata?: string) {
    const at = new AccessToken(lk.apiKey, lk.apiSecret, { identity, ttl: ttlSeconds, metadata });
    at.addGrant(grant);
    return at.toJwt();
  }

  /**
   * Call Boson's session routes, retrying the answers in RETRYABLE_CODES after
   * Retry-After, or 1s then 2s when there is none. A network error is thrown,
   * not retried: for a create, the avatar may already be in the room.
   */
  async function boson(path: string, init: RequestInit = {}) {
    for (let attempt = 1; ; attempt++) {
      const upstream = await fetchImpl(`${baseUrl}/v1/avatar/sessions${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      });
      const text = await upstream.text();
      if (upstream.ok) return { upstream, text };

      const code = upstreamErrorCode(text);
      const wait = retryAfterSeconds(upstream.headers.get("retry-after")) ?? attempt;
      if (code && RETRYABLE_CODES.has(code) && attempt < MAX_ATTEMPTS && wait <= MAX_RETRY_WAIT_SECONDS) {
        console.warn(`avatar ${code}: retrying in ${wait}s (attempt ${attempt})`);
        await sleep(wait * 1000);
        continue;
      }
      // The avatar token is in our request, never in Boson's answer, so the body is safe to log.
      console.error(`avatar ${init.method ?? "GET"} failed: ${upstream.status} ${text}`);
      return { upstream, text };
    }
  }

  /** Pass a Boson error on: its status, its code, and Retry-After if it sent one. */
  function sendUpstreamError(res: ExpressResponse, upstream: Response, text: string) {
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) res.set("Retry-After", retryAfter);
    return res.status(upstream.status).json({ error: upstreamErrorCode(text) ?? "avatar_upstream_error" });
  }

  /**
   * POST /api/livekit/token  { language?, level? }
   *
   * A fresh room and a short-lived token for the learner. Joining dispatches
   * the agent. The learner publishes only a microphone, and may publish data
   * because answering the agent's tool calls (#32) is an RPC reply.
   *
   * The picked language and level go in the token's participant metadata,
   * which the agent reads to choose its prompt from shared/prompts.json.
   * Anything unknown falls back to the default pair rather than failing.
   */
  router.post("/livekit/token", async (req, res) => {
    if (!livekit) return res.status(500).json({ error: "livekit_not_configured" });
    const room = `${ROOM_PREFIX}${randomId()}`;
    const identity = `learner-${randomId()}`;
    const metadata = JSON.stringify({
      language: targetLanguageFor(req.body?.language),
      level: learnerLevelFor(typeof req.body?.level === "string" ? req.body.level : null),
    });
    const jwt = await token(
      livekit,
      identity,
      LEARNER_TOKEN_TTL_SECONDS,
      {
        roomJoin: true,
        room,
        canPublishSources: [TrackSource.MICROPHONE],
        canSubscribe: true,
        canPublishData: true,
      },
      metadata,
    );
    return res.json({ url: livekit.url, room, identity, token: jwt });
  });

  /**
   * POST /api/avatar/sessions  { room }
   *
   * Adds the avatar to a room the learner has already joined: Boson ends a
   * session once no other participant is left, so it must not start first.
   *
   * Creation is not idempotent, so only answers that say nothing was created
   * are retried (see `boson`).
   */
  router.post("/avatar/sessions", async (req, res) => {
    if (!apiKey || !livekit) return res.status(500).json({ error: "avatar_not_configured" });
    const room = typeof req.body?.room === "string" ? req.body.room : "";
    if (!ROOM_NAME.test(room)) return res.status(400).json({ error: "room_required" });

    const participantToken = await token(livekit, AVATAR_IDENTITY, maxDurationSeconds + AVATAR_TOKEN_SLACK_SECONDS, {
      roomJoin: true,
      room,
      canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
      canPublishData: true,
      canSubscribe: true,
    });
    const body = JSON.stringify({
      avatar_id: avatarId,
      max_duration_seconds: maxDurationSeconds,
      transport: {
        type: "livekit",
        url: livekit.url,
        room_name: room,
        participant_token: participantToken,
        participant_identity: AVATAR_IDENTITY,
        publisher_identity: AGENT_IDENTITY,
      },
    });

    try {
      const { upstream, text } = await boson("", { method: "POST", body });
      if (!upstream.ok) return sendUpstreamError(res, upstream, text);
      const session = JSON.parse(text) as Record<string, unknown>;
      sessions.add(String(session.id));
      return res.status(201).json(sessionView(session));
    } catch (err) {
      console.error("Avatar session error:", err);
      return res.status(502).json({ error: "avatar_unavailable" });
    }
  });

  /** GET /api/avatar/sessions/:id: `active`, `releasing` or `terminated`. */
  router.get("/avatar/sessions/:id", async (req, res) => {
    if (!apiKey) return res.status(500).json({ error: "avatar_not_configured" });
    if (!sessions.has(req.params.id)) return res.status(404).json({ error: "session_not_found" });
    return forward(res, () => boson(`/${encodeURIComponent(req.params.id)}`));
  });

  /**
   * DELETE /api/avatar/sessions/:id, when the learner leaves.
   *
   * Boson also ends a session at expires_at or when the room empties, but in
   * a live run the avatar stayed active after the learner left (the agent was
   * still in the room), so this is what frees the capacity slot. Releasing
   * twice is harmless upstream; the answer may be `releasing`.
   */
  router.delete("/avatar/sessions/:id", async (req, res) => {
    if (!apiKey) return res.status(500).json({ error: "avatar_not_configured" });
    if (!sessions.has(req.params.id)) return res.status(404).json({ error: "session_not_found" });
    return forward(res, () => boson(`/${encodeURIComponent(req.params.id)}`, { method: "DELETE" }));
  });

  async function forward(res: ExpressResponse, call: () => ReturnType<typeof boson>) {
    try {
      const { upstream, text } = await call();
      if (!upstream.ok) return sendUpstreamError(res, upstream, text);
      return res.json(sessionView(JSON.parse(text) as Record<string, unknown>));
    } catch (err) {
      console.error("Avatar session error:", err);
      return res.status(502).json({ error: "avatar_unavailable" });
    }
  }

  return router;
}
