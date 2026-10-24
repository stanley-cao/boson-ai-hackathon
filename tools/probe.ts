/**
 * A headless Realtime session, in one file.
 *
 * It mints an ephemeral key, opens the socket, sends the same session config
 * the browser app sends, takes one or more turns, prints every server event as
 * it arrives, and writes the whole stream to `captures/`.
 *
 * This is not part of the app — it is a debugging instrument, and it earns its
 * place three times over:
 *
 *  1. When something breaks, it tells you whether the problem is in your audio
 *     code or your protocol code. The probe has no audio hardware at all.
 *  2. `session.created` echoes the *resolved* session — every default the
 *     server filled in. That is the only way to see what you actually got.
 *  3. The captured event stream is a fixture. Real recorded events, replayed in
 *     a unit test, beat hand-written ones every time. Part 3's reducer test is
 *     built on exactly that.
 *
 * Usage:
 *   npm run probe                                  ask a default question as text
 *   npm run probe -- --text "hello"                a typed turn
 *   npm run probe -- --say "hello there"           SPEAK a turn (synthesised, streamed
 *                                                  in as microphone audio)
 *   npm run probe -- --say "a" --say "b"           several spoken turns in order
 *   npm run probe -- --audio recording.wav         stream a WAV file you already have
 *   npm run probe -- --say "hi" --out captures/x.json
 *   npm run probe -- --say "I went to the [pause 1500] market"
 *                                                  a spoken turn with a silent gap
 *   npm run probe -- --turn-detection '{"type":"server_vad","silence_duration_ms":1000}' --say "hi"
 *                                                  override the session's turn detection
 *
 * `--say` uses the text-to-speech API to synthesise the utterance, then feeds it
 * to the Realtime session the same way the browser feeds microphone audio:
 * 24 kHz PCM16, base64, ~100 ms at a time, paced in real time. That means it
 * exercises the whole input path — turn detection, transcription, tool calls —
 * with no microphone and no human in the loop.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";
import {
  AUDIO_RATE,
  buildLevelUpdate,
  buildSessionConfig,
  levelChangeFromTool,
} from "../src/realtime/sessionConfig";
import { ACTIVE_LEVEL, type LearnerLevel } from "../src/lang/profiles";
import {
  describeClose,
  functionCallOutput,
  inputAudioAppend,
  responseCreate,
  userTextItem,
} from "../src/realtime/events";
import { dispatch as dispatchTool } from "../src/tools/registry";

dotenv.config();

const BOSON_BASE_URL = process.env.BOSON_BASE_URL ?? "https://api.boson.ai";
const WS_URL = "wss://api.boson.ai/v1/realtime?model=higgs-realtime";

// ~100 ms per chunk, matching what the browser sends.
const CHUNK_SAMPLES = AUDIO_RATE / 10;
// Minimum trailing silence after each utterance. The server's VAD needs to
// *hear* silence to decide your turn is over; a spoken turn keeps streaming
// it past this until a reply starts, so a long silence_duration_ms still works.
const TRAILING_SILENCE_MS = 900;
// A microphone keeps sending silence until the user speaks again, so after a
// spoken turn we keep streaming it until a reply starts. The cap only stops a
// session whose VAD never closes the turn from hanging the probe.
const MAX_TRAILING_SILENCE_MS = 8000;
// `[pause 1500]` inside a --say utterance: synthesise the parts separately and
// join them with that much silence, to imitate a learner searching for a word.
const PAUSE_MARK = /\[pause (\d+)\]/;
// How long nothing may be in flight before a turn counts as finished.
const IDLE_HOLD_MS = 1500;

/**
 * `barge` is `say` that does not wait its turn: it starts talking 1.5 s into
 * the previous reply instead of after it. That is how you produce a genuine
 * interruption without a human, which Part 2 needs to verify truncation and
 * Part 3 needs in order to record a realistic fixture.
 */
type Turn =
  | { kind: "text"; value: string }
  | { kind: "say"; value: string }
  | { kind: "barge"; value: string }
  | { kind: "audio"; value: string };

interface ProbeArgs {
  turns: Turn[];
  out: string | null;
  /** Replaces session.audio.input.turn_detection, for comparing VAD settings. */
  turnDetection: Record<string, unknown> | null;
}

function parseArgs(argv: string[]): ProbeArgs {
  const turns: Turn[] = [];
  let out: string | null = null;
  let turnDetection: Record<string, unknown> | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--text") turns.push({ kind: "text", value: argv[++i] });
    else if (a === "--say") turns.push({ kind: "say", value: argv[++i] });
    else if (a === "--barge") turns.push({ kind: "barge", value: argv[++i] });
    else if (a === "--audio") turns.push({ kind: "audio", value: argv[++i] });
    else if (a === "--out") out = argv[++i];
    else if (a === "--turn-detection") turnDetection = JSON.parse(argv[++i]);
    else if (!a.startsWith("--")) turns.push({ kind: "text", value: a });
  }
  if (turns.length === 0) {
    turns.push({ kind: "text", value: "In one short sentence, what is a sample rate?" });
  }
  return { turns, out, turnDetection };
}

function loadApiKey(): string {
  const inline = process.env.BOSON_API_KEY?.trim();
  if (inline) return inline;
  const keyFile = process.env.BOSON_API_KEY_FILE;
  if (keyFile) {
    const fromFile = readFileSync(keyFile, "utf8").trim();
    if (fromFile) return fromFile;
  }
  throw new Error("No API key. Set BOSON_API_KEY or BOSON_API_KEY_FILE in .env.");
}

async function mintEphemeralKey(apiKey: string): Promise<string> {
  const res = await fetch(`${BOSON_BASE_URL}/v1/realtime/client_secrets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expires_after: { seconds: 600 } }),
  });
  if (!res.ok) throw new Error(`client_secrets ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { value: string }).value;
}

// --- audio in ---------------------------------------------------------------

/**
 * Pull the PCM16 samples out of a WAV file.
 *
 * A WAV is a sequence of labelled chunks, so we walk them rather than assuming
 * the header is 44 bytes — plenty of encoders insert extra chunks before the
 * audio, and skipping a fixed 44 bytes would feed you metadata as if it were
 * sound.
 */
function decodeWav(buf: Buffer): { samples: Int16Array; rate: number } {
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not a WAV file");
  let rate = AUDIO_RATE;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      const bits = buf.readUInt16LE(body + 14);
      const channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      if (bits !== 16 || channels !== 1) {
        throw new Error(`need 16-bit mono, got ${bits}-bit ${channels}-channel`);
      }
    } else if (id === "data") {
      const slice = buf.subarray(body, body + size);
      return {
        samples: new Int16Array(slice.buffer, slice.byteOffset, slice.length / 2),
        rate,
      };
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }
  throw new Error("no data chunk in WAV");
}

async function synthesize(apiKey: string, text: string): Promise<Int16Array> {
  const res = await fetch(`${BOSON_BASE_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "higgs-tts-3",
      input: text,
      voice: "default",
      response_format: "wav",
    }),
  });
  if (!res.ok) throw new Error(`speech ${res.status}: ${await res.text()}`);
  const { samples, rate } = decodeWav(Buffer.from(await res.arrayBuffer()));
  if (rate !== AUDIO_RATE) {
    throw new Error(`TTS returned ${rate} Hz, session expects ${AUDIO_RATE} Hz`);
  }
  return samples;
}

/** Synthesise an utterance, turning each `[pause N]` mark into N ms of silence. */
async function synthesizeWithPauses(apiKey: string, text: string): Promise<Int16Array> {
  // split() with a capture group interleaves the text parts and pause lengths.
  const parts = text.split(new RegExp(PAUSE_MARK.source, "g"));
  const pieces: Int16Array[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) pieces.push(new Int16Array(Math.round((Number(parts[i]) / 1000) * AUDIO_RATE)));
    else if (parts[i].trim()) pieces.push(await synthesize(apiKey, parts[i].trim()));
  }
  const joined = new Int16Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) {
    joined.set(p, at);
    at += p.length;
  }
  return joined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stream samples into the session the way a microphone would: ~100 ms at a
 * time, paced in real time, followed by silence so the VAD closes the turn.
 *
 * The pacing matters. Dump the whole utterance at once and the server sees
 * several seconds of speech arrive in one instant, which is not what turn
 * detection is designed around.
 */
async function streamSamples(
  send: (evt: unknown) => void,
  samples: Int16Array,
  replyStartedSince?: (t: number) => boolean,
  log?: (msg: string) => void,
): Promise<void> {
  const sendChunk = (chunk: Int16Array) => {
    const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length * 2);
    send(inputAudioAppend(bytes.toString("base64")));
  };
  for (let i = 0; i < samples.length; i += CHUNK_SAMPLES) {
    sendChunk(samples.subarray(i, Math.min(i + CHUNK_SAMPLES, samples.length)));
    await sleep(100);
  }
  // Logged so end-of-turn latency can be read off against response.created.
  log?.("speech audio ended");
  const speechEndedAt = Date.now();

  const silence = new Int16Array(CHUNK_SAMPLES);
  // Without a reply check (barge-in), send the fixed margin only. A reply to
  // an earlier fragment of the turn does not count: the turn's end has not
  // been heard until a reply starts after the speech is over.
  const maxMs = replyStartedSince ? MAX_TRAILING_SILENCE_MS : TRAILING_SILENCE_MS;
  for (let ms = 0; ms < maxMs; ms += 100) {
    if (ms >= TRAILING_SILENCE_MS && replyStartedSince?.(speechEndedAt)) break;
    sendChunk(silence);
    await sleep(100);
  }
}

// --- reporting --------------------------------------------------------------

/** One line per event: the type, plus whichever field carries the payload. */
function summarize(evt: Record<string, unknown>): string {
  const type = String(evt.type);
  if (type === "response.output_audio.delta") {
    const b64 = typeof evt.delta === "string" ? evt.delta : "";
    const samples = Math.round((b64.length * 0.75) / 2);
    return `${type}  ${b64.length} b64 chars ≈ ${samples} samples ≈ ${((samples / AUDIO_RATE) * 1000).toFixed(0)}ms`;
  }
  if (type === "response.function_call_arguments.done") {
    return `${type}  ${String(evt.name)}(${String(evt.arguments)})  call_id=${String(evt.call_id)}`;
  }
  if (typeof evt.delta === "string") return `${type}  ${JSON.stringify(evt.delta)}`;
  if (typeof evt.transcript === "string") return `${type}  ${JSON.stringify(evt.transcript)}`;
  if (type === "error") return `${type}  ${JSON.stringify(evt.error ?? evt)}`;
  return type;
}

async function main() {
  const { turns, out, turnDetection } = parseArgs(process.argv.slice(2));
  const apiKey = loadApiKey();
  const key = await mintEphemeralKey(apiKey);
  console.log(`minted ${key.slice(0, 12)}…\nconnecting to ${WS_URL}\n`);

  const events: unknown[] = [];
  const startedAt = Date.now();
  let audioChunks = 0;
  let audioSamples = 0;
  let sessionReady!: () => void;
  const ready = new Promise<void>((r) => (sessionReady = r));
  let responseDone: (() => void) | null = null;
  // Counters rather than one-shot callbacks: a barge-in needs to ask "is a
  // response in flight *right now*", which a promise created after the fact
  // cannot answer.
  let responsesCreated = 0;
  let responsesDone = 0;
  const handledCallIds = new Set<string>();
  /**
   * How many extra response.done events to expect because we answered a tool
   * call and asked for another reply.
   *
   * Counting *responses* rather than in-flight dispatches matters: a tool here
   * finishes in under a millisecond, so any "is a tool still running" flag is
   * already false by the time the tool turn's response.done arrives over the
   * network, and the probe would stop one reply too early.
   */
  let extraResponsesExpected = 0;
  let lastResponseCreatedAt = 0;
  // Tracked like the browser does, so a "I'm intermediate" turn re-instructs
  // the session here too.
  let level: LearnerLevel = ACTIVE_LEVEL;

  const ws = new WebSocket(WS_URL, ["realtime", `bai-client-secret.${key}`]);
  const send = (evt: unknown) => ws.send(JSON.stringify(evt));

  ws.addEventListener("open", () => {
    console.log("open — sending session.update\n");
    const config = buildSessionConfig() as unknown as {
      session: { audio: { input: { turn_detection: unknown } } };
    };
    if (turnDetection) config.session.audio.input.turn_detection = turnDetection;
    send(config);
  });

  ws.addEventListener("message", (ev) => {
    const evt = JSON.parse(String(ev.data)) as Record<string, unknown>;
    events.push(evt);

    if (evt.type === "response.output_audio.delta") {
      const b64 = typeof evt.delta === "string" ? evt.delta : "";
      audioChunks++;
      audioSamples += Math.round((b64.length * 0.75) / 2);
      if (audioChunks > 1) return; // print the first, then count quietly
    }

    console.log(`[${String(Date.now() - startedAt).padStart(6)}ms] ${summarize(evt)}`);

    if (evt.type === "session.created") {
      // The resolved session: our fields plus every default the server filled
      // in. The single most useful thing the probe prints.
      console.log("\n--- resolved session (server defaults included) ---");
      console.log(JSON.stringify(evt.session, null, 2));
      console.log("---\n");
      sessionReady();
    }
    if (evt.type === "response.created") {
      responsesCreated++;
      lastResponseCreatedAt = Date.now();
    }

    // Run tools, the same way the browser does — same registry, same
    // handled-call_id guard. Without this the probe would stop at the tool
    // call and never see the answer the model gives afterwards.
    if (evt.type === "response.function_call_arguments.done") {
      const callId = String(evt.call_id ?? "");
      const name = String(evt.name ?? "");
      if (callId && name && !handledCallIds.has(callId)) {
        handledCallIds.add(callId);
        extraResponsesExpected++;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(evt.arguments ?? "{}"));
        } catch {
          /* run it empty and let the handler complain */
        }
        void (async () => {
          const result = await dispatchTool(name, args);
          console.log(`        ↳ ${name} -> ${result.summary}`);
          const next = levelChangeFromTool(name, result, level);
          if (next) {
            level = next;
            console.log(`        ↳ level is now ${level}; sending session.update`);
            send(buildLevelUpdate(level));
          }
          send(functionCallOutput(callId, JSON.stringify(result)));
          send(responseCreate());
        })();
      }
    }

    if (evt.type === "response.done") {
      responsesDone++;
      // A turn that only asked for a tool is not the turn we are waiting for —
      // the real answer comes in the response that follows the tool result.
      //
      // Note we cannot detect that from response.done itself: verified
      // 2026-08-07, its `output` array lists only the spoken message, NOT the
      // function_call. So we count dispatches instead.
      if (extraResponsesExpected > 0) {
        extraResponsesExpected--;
        return;
      }
      responseDone?.();
      responseDone = null;
    }
  });

  ws.addEventListener("close", (ev) => {
    const info = describeClose(ev.code, ev.reason);
    console.log(`\nclosed: ${info.message}`);
    console.log(
      `audio received: ${audioChunks} chunks, ${audioSamples} samples ≈ ${(audioSamples / AUDIO_RATE).toFixed(2)}s`,
    );
    mkdirSync("captures", { recursive: true });
    const path = out ?? `captures/probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(path, JSON.stringify(events, null, 2));
    console.log(`${events.length} events written to ${path}`);
    process.exit(info.code === 1000 ? 0 : 1);
  });

  ws.addEventListener("error", () => {
    console.error("socket error — see the close code below");
  });

  await ready;

  /**
   * Resolves once no reply is in flight or owed after a tool call, and that
   * has held for IDLE_HOLD_MS. The hold covers the short gap between a commit
   * and its response.created, and between a tool result and the reply to it.
   */
  const waitUntilIdle = async (): Promise<void> => {
    const deadline = Date.now() + 45_000;
    let idleSince = Date.now();
    while (Date.now() < deadline) {
      const busy = responsesCreated > responsesDone || extraResponsesExpected > 0;
      if (busy) idleSince = Date.now();
      else if (Date.now() - idleSince >= IDLE_HOLD_MS) return;
      await sleep(50);
    }
  };

  for (let ti = 0; ti < turns.length; ti++) {
    const turn = turns[ti];
    if (turn.kind === "barge") {
      // Synthesise FIRST. Text-to-speech takes a second or two, and the window
      // we are aiming at is only a couple of seconds wide.
      const samples = await synthesize(apiKey, turn.value);

      // Wait for a response to actually be in flight — created but not done.
      const deadline = Date.now() + 20_000;
      while (responsesCreated <= responsesDone && Date.now() < deadline) await sleep(25);

      if (responsesCreated <= responsesDone) {
        console.log("\n>>> no response in flight to interrupt — speaking normally\n");
      } else {
        // Let it get a little way in, so there is something to cut off.
        await sleep(700);
        console.log(`\n>>> BARGING IN: ${JSON.stringify(turn.value)}\n`);
      }

      const waitForNewReply = new Promise<void>((r) => (responseDone = r));
      await streamSamples(send, samples);
      await Promise.race([waitForNewReply, sleep(45_000)]);
      continue;
    }

    const waitForReply = new Promise<void>((r) => (responseDone = r));

    if (turn.kind === "text") {
      console.log(`\n>>> typing: ${JSON.stringify(turn.value)}\n`);
      send(userTextItem(turn.value));
      // A typed turn has no speech for the VAD to detect, so we ask explicitly.
      send(responseCreate());
    } else {
      const samples =
        turn.kind === "say"
          ? await synthesizeWithPauses(apiKey, turn.value)
          : decodeWav(readFileSync(turn.value)).samples;
      console.log(
        `\n>>> speaking (${(samples.length / AUDIO_RATE).toFixed(1)}s): ${JSON.stringify(turn.value)}\n`,
      );
      // No response.create here: turn detection starts the reply itself.
      await streamSamples(
        send,
        samples,
        (t) => lastResponseCreatedAt >= t,
        (msg) => console.log(`[${String(Date.now() - startedAt).padStart(6)}ms] probe: ${msg}`),
      );
    }

    // If the next turn is a barge-in, do NOT wait for this reply to finish —
    // there would be nothing left to interrupt.
    if (turns[ti + 1]?.kind === "barge") continue;
    await Promise.race([waitForReply, sleep(45_000)]);
    // One spoken turn can produce several replies: the VAD may cut it at
    // a pause (seen 2026-10-24: "Can you check this sentence?" got "Sure!"
    // before the sentence itself had been streamed), and that early reply
    // resolves waitForReply. Without this the probe moved on, or closed,
    // while the reply to the rest of the turn, or the reply after its tool
    // call, was still coming.
    await waitUntilIdle();
  }

  // Let any trailing events land before closing.
  await sleep(500);
  ws.close(1000, "probe complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
