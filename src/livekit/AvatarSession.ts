import {
  ConnectionState as RoomConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  createAudioAnalyser,
  type LocalAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteVideoTrack,
} from "livekit-client";
import type { LearnerLevel, TargetLanguageCode } from "../lang/profiles";
import type { ServerEvent } from "../realtime/events";
import type { Activity, ConnectionState, LogEntry } from "../realtime/RealtimeClient";
import { registerToolRpc } from "./toolRpc";
import { TRANSCRIPTION_TOPIC, readTranscription, tutorActivityFrom } from "./transcription";

/**
 * Avatar mode (#35): the tutor through a LiveKit Cloud room with a Higgs Avatar.
 *
 *   mic ──► LiveKit room ──► agent (livekit/agent.py) ──► Higgs Realtime
 *   avatar video + audio ◄── LiveKit room ◄── Higgs Avatar ◄── agent's speech
 *
 * The browser never talks to Boson here: server/avatar.ts mints the room token
 * and creates the avatar session. Tool calls arrive over RPC (toolRpc.ts) and
 * transcripts over text streams (transcription.ts), both turned into the same
 * events as direct-WebSocket mode, so the transcript and study panel are shared.
 *
 * The callbacks match RealtimeClient's so App can drive either one.
 */

/** The typed-text input LiveKit Agents listens on by default. */
const CHAT_TOPIC = "lk.chat";
const METER_INTERVAL_MS = 100;
// The identity livekit/agent.py joins as (AGENT_IDENTITY in server/avatar.ts).
const AGENT_IDENTITY = "polyglot-tutor";
// The agent joined ~1.5 s after the learner in live runs. Without it the
// avatar would stand there silent and nothing would hear the mic.
const AGENT_JOIN_TIMEOUT_MS = 10_000;

export interface AvatarCallbacks {
  onConnectionState?: (s: ConnectionState) => void;
  onActivity?: (a: Activity) => void;
  onLog?: (entry: LogEntry) => void;
  onServerEvent?: (evt: ServerEvent) => void;
  /** The room closed without the learner leaving. */
  onClose?: (info: { message: string }) => void;
  onMicChange?: (active: boolean) => void;
  onMicLevel?: (rms: number) => void;
  /** The avatar's video track, or null once it is gone. */
  onVideo?: (track: RemoteVideoTrack | null) => void;
}

export interface AvatarSessionOptions extends AvatarCallbacks {
  /** For tests. */
  fetchImpl?: typeof fetch;
  createRoom?: () => Room;
  agentJoinTimeoutMs?: number;
}

/**
 * Avatar mode couldn't start, so App switches to direct-WebSocket mode.
 * `code` is the token server's error (`capacity_exhausted`,
 * `livekit_not_configured`, …) or the reason the room didn't connect.
 */
export class AvatarUnavailableError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfter: string | null = null,
  ) {
    super(`Avatar unavailable (${code})`);
    this.name = "AvatarUnavailableError";
  }
}

interface LiveKitToken {
  url: string;
  room: string;
  identity: string;
  token: string;
}

interface AvatarSessionView {
  id: string;
  status: string;
}

// LogEntry ids key the debug drawer's list, shared with RealtimeClient's
// entries; counting down keeps the two sequences from colliding.
let logSeq = 0;

export class AvatarSession {
  private readonly cb: AvatarCallbacks;
  private readonly fetchImpl: typeof fetch;
  private readonly createRoom: () => Room;
  private readonly agentJoinTimeoutMs: number;

  private room: Room | null = null;
  private sessionId: string | null = null;
  private state: ConnectionState = "idle";
  // Room states are only reported once the avatar exists: a room without one
  // is a failed attempt, not a session (the recap keys off "open").
  private ready = false;
  private stopRpc: (() => void) | null = null;
  private meter: { timer: ReturnType<typeof setInterval>; cleanup: () => Promise<void> } | null = null;
  private mic = false;

  constructor({ fetchImpl, createRoom, agentJoinTimeoutMs, ...callbacks }: AvatarSessionOptions = {}) {
    this.cb = callbacks;
    this.agentJoinTimeoutMs = agentJoinTimeoutMs ?? AGENT_JOIN_TIMEOUT_MS;
    // Bound, because a bare window.fetch throws "Illegal invocation".
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
    this.createRoom = createRoom ?? (() => new Room({ adaptiveStream: true, dynacast: true }));
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  get micActive(): boolean {
    return this.mic;
  }

  /**
   * Join a fresh room, publish the mic, wait for the agent, then add the
   * avatar. Throws AvatarUnavailableError, after leaving the room, if any step
   * fails (`agent_not_running` when no agent joins). Resolves quietly if the
   * learner disconnects before it finishes. The language and level pick the
   * agent's prompt, through the room token (server/avatar.ts).
   */
  async connect(language?: TargetLanguageCode, level?: LearnerLevel): Promise<void> {
    if (this.room) {
      this.info("connect() ignored — a room is already joined.");
      return;
    }
    const room = this.createRoom();
    this.room = room;
    this.ready = false;
    this.setState("connecting");
    // Disconnect works while connecting (avatar creation takes ~2 s), and
    // leave() then clears this.room: every step after an await checks that.
    const cancelled = () => this.room !== room;

    try {
      const lk = await this.post<LiveKitToken>("/api/livekit/token", { language, level });
      if (cancelled()) return;
      const emit = (evt: ServerEvent) => this.cb.onServerEvent?.(evt);
      // Both handlers go on before connecting: the agent greets, and may call
      // a tool, as soon as the learner joins (toolRpc.ts).
      this.stopRpc = registerToolRpc(room, emit);
      room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, { identity }) => {
        void readTranscription(reader, identity === lk.identity, emit);
      });
      this.listen(room);

      await room.connect(lk.url, lk.token);
      if (cancelled()) return;
      this.info(`Joined ${lk.room} as ${lk.identity}.`);
      // Allowed because connect() runs from the Connect click.
      await room.startAudio();
      await this.setMic(true);
      if (cancelled()) return;

      // Before the avatar, so a missing agent doesn't hold an avatar slot.
      const agentJoined = await this.waitForAgent(room);
      if (cancelled()) return;
      if (!agentJoined) throw new AvatarUnavailableError("agent_not_running");

      // Only now: Boson ends a session once no other participant is left.
      const session = await this.post<AvatarSessionView>("/api/avatar/sessions", { room: lk.room });
      this.sessionId = session.id;
      if (cancelled()) {
        // Created as the learner left: release it, or it holds a slot.
        this.releaseAvatar();
        return;
      }
      this.info(`Avatar session ${session.id} is ${session.status}.`);
      globalThis.addEventListener?.("pagehide", this.releaseAvatar);
      this.ready = true;
      this.setState("open");
    } catch (e) {
      // Leaving mid-connect makes room.connect() reject; that isn't a failure.
      if (cancelled()) return;
      const error =
        e instanceof AvatarUnavailableError
          ? e
          : new AvatarUnavailableError(e instanceof Error ? e.message : String(e));
      this.info(error.message);
      await this.leave();
      throw error;
    }
  }

  disconnect(): void {
    // Logged so the event log shows whether a Disconnect press got here.
    this.info(`disconnect() while ${this.state}.`);
    if (!this.room) {
      this.setState("closed");
      return;
    }
    this.setState("closing");
    void this.leave();
  }

  close(): Promise<void> {
    return this.leave();
  }

  async startMic(): Promise<void> {
    await this.setMic(true);
  }

  async stopMic(): Promise<void> {
    await this.setMic(false);
  }

  /** A typed message; the agent answers it like speech. */
  sendUserText(text: string): void {
    if (!this.room || !this.ready) {
      this.info("sendUserText ignored — the room is not joined.");
      return;
    }
    void this.room.localParticipant.sendText(text, { topic: CHAT_TOPIC });
    this.log("send", CHAT_TOPIC, { text });
  }

  // --- internals -------------------------------------------------------------

  /** True once the tutor agent is in the room; false after the timeout. */
  private waitForAgent(room: Room): Promise<boolean> {
    if (room.remoteParticipants.has(AGENT_IDENTITY)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onJoin = (p: RemoteParticipant) => {
        if (p.identity === AGENT_IDENTITY) done(true);
      };
      const timer = setTimeout(() => done(false), this.agentJoinTimeoutMs);
      const done = (joined: boolean) => {
        clearTimeout(timer);
        room.off(RoomEvent.ParticipantConnected, onJoin);
        resolve(joined);
      };
      room.on(RoomEvent.ParticipantConnected, onJoin);
    });
  }

  private listen(room: Room): void {
    room
      .on(RoomEvent.ConnectionStateChanged, (s) => {
        if (!this.ready) return;
        if (s === RoomConnectionState.Connected) this.setState("open");
        else if (s !== RoomConnectionState.Disconnected) this.setState("connecting");
      })
      .on(RoomEvent.Disconnected, (reason) => {
        // Our own leave() has already cleaned up and cleared this.room.
        if (this.room !== room) return;
        const why = reason === undefined ? "unknown" : DisconnectReason[reason];
        this.cb.onClose?.({ message: `The LiveKit room closed (${why}). Reconnect to start again.` });
        void this.leave();
      })
      .on(RoomEvent.TrackSubscribed, (track) => this.attach(track))
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
        if (track.kind === Track.Kind.Video) this.cb.onVideo?.(null);
      })
      .on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
        const activity = tutorActivityFrom(changed, participant?.identity, AGENT_IDENTITY);
        if (activity) this.cb.onActivity?.(activity);
      });
  }

  /**
   * Play every remote audio track: the agent's until #34 routes its speech to
   * the avatar, the avatar's after. The learner publishes only a mic and the
   * agent only audio, so the one video track is the avatar's.
   */
  private attach(track: RemoteTrack): void {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      el.hidden = true;
      document.body.appendChild(el);
    } else if (track.kind === Track.Kind.Video) {
      this.cb.onVideo?.(track as RemoteVideoTrack);
    }
  }

  private async setMic(on: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    const publication = await room.localParticipant.setMicrophoneEnabled(on);
    this.stopMeter();
    if (on && publication?.track) this.startMeter(publication.track as LocalAudioTrack);
    this.mic = on;
    this.cb.onMicChange?.(on);
  }

  private startMeter(track: LocalAudioTrack): void {
    const { calculateVolume, cleanup } = createAudioAnalyser(track);
    const timer = setInterval(() => this.cb.onMicLevel?.(calculateVolume()), METER_INTERVAL_MS);
    this.meter = { timer, cleanup };
  }

  private stopMeter(): void {
    if (!this.meter) return;
    clearInterval(this.meter.timer);
    void this.meter.cleanup();
    this.meter = null;
    this.cb.onMicLevel?.(0);
  }

  /**
   * Free the avatar's capacity slot. In live runs it stayed active after the
   * learner left (server/avatar.ts), so this can't be left to Boson.
   * `keepalive` lets the request outlive the page on pagehide.
   */
  private releaseAvatar = (): void => {
    const id = this.sessionId;
    if (!id) return;
    this.sessionId = null;
    globalThis.removeEventListener?.("pagehide", this.releaseAvatar);
    this.fetchImpl(`/api/avatar/sessions/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true })
      .then((res) => this.info(`Avatar session ${id} released (${res.status}).`))
      .catch((e) => this.info(`Avatar session ${id} release failed: ${String(e)}`));
  };

  /** Leave the room and undo everything connect() set up. Safe to call twice. */
  private async leave(): Promise<void> {
    const room = this.room;
    if (!room) return;
    this.room = null;
    this.ready = false;
    this.releaseAvatar();
    this.stopRpc?.();
    this.stopRpc = null;
    room.unregisterTextStreamHandler(TRANSCRIPTION_TOPIC);
    this.stopMeter();
    await room.disconnect();
    if (this.mic) {
      this.mic = false;
      this.cb.onMicChange?.(false);
    }
    this.cb.onVideo?.(null);
    this.cb.onActivity?.("idle");
    this.setState("closed");
  }

  /** POST to the token server; a failure becomes AvatarUnavailableError. */
  private async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: unknown; token?: unknown };
    // The drawer shows everything else; a room token has no business in it.
    this.log("recv", path, { ...data, token: data.token === undefined ? undefined : "…" });
    if (!res.ok) {
      const code = typeof data.error === "string" ? data.error : `http_${res.status}`;
      throw new AvatarUnavailableError(code, res.headers.get("retry-after"));
    }
    return data as T;
  }

  private setState(s: ConnectionState): void {
    this.state = s;
    this.cb.onConnectionState?.(s);
  }

  private info(message: string): void {
    this.log("info", "info", message);
  }

  private log(dir: LogEntry["dir"], type: string, raw: unknown): void {
    this.cb.onLog?.({ id: --logSeq, dir, type, at: Date.now(), raw });
  }
}
