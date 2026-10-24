# Architecture

How the template is laid out, and where to make changes. The code is adapted from Boson AI's [higgs-realtime-tutorial](https://github.com/boson-ai/higgs-realtime-tutorial). Its source files are heavily commented, so read them for the details.

## The big picture

```
 Browser (React, :5173)                      Token server (Express, :3000)        Boson API
 ─────────────────────────                   ─────────────────────────────        ─────────
 App.tsx ──fetch /api/token──► (Vite proxy) ─► GET /api/token ──POST /v1/realtime/client_secrets──► mints bai-eph-… key
                                                                                                  (10 min TTL)
 RealtimeClient ──────────── WebSocket wss://api.boson.ai/v1/realtime?model=higgs-realtime ──────► Higgs Realtime
   ▲  │  session.update, input_audio_buffer.append, function_call_output, truncate …   ──►
   │  ▼  ◄── response.output_audio.delta, transcripts, speech_started, function calls …
 MicCapture (mic → PCM16 24 kHz)    RingPlayer (PCM16 → speakers)
```

There are two processes:

1. **Token server** (`server/index.ts`). It holds `BOSON_API_KEY` and exposes one route, `GET /api/token`, which exchanges the real key for a short-lived ephemeral key. The real key never reaches the browser.
2. **Browser app** (`src/`). It fetches an ephemeral key, opens a WebSocket straight to Higgs Realtime, streams microphone audio up, and plays the model's audio back. After the token is fetched, everything goes over that WebSocket and the token server is idle.

In development, Vite proxies `/api/*` to `:3000` (`vite.config.ts`), so the browser only sees one origin and no CORS setup is needed.

## Directory map

```
server/index.ts              Token server (ephemeral key minting)
src/
  main.tsx                   React entry point
  App.tsx                    Top-level UI and state wiring
  realtime/
    sessionConfig.ts         ★ System prompt, voice, audio format, VAD, transcription, tools
    RealtimeClient.ts        WebSocket lifecycle, event routing, barge-in, tool-call loop
    events.ts                Event-name constants, client-event builders, close-code meanings
  audio/
    capture.ts               Mic → resample to 24 kHz → PCM16 → base64 chunks (~100 ms)
    playback.ts              base64 PCM16 → AudioWorklet ring buffer → speakers
    resample.ts              Sample-rate conversion (unit tested)
    loadWorklet.ts           Loads worklet source as a Blob URL
    worklets/*.js            AudioWorklet processors (run on the audio thread)
  state/
    transcriptStore.ts       Pure reducer: server events → ordered transcript
  tools/
    definitions.ts           ★ Tool JSON schemas sent to the model
    handlers.ts              ★ Tool implementations (currently a dummy web search)
    registry.ts              dispatch(name, args): one entry point, never throws
    searchIndex.json         Fake "web" for the dummy search tool
  ui/                        Presentational components: StatusBar, MicButton,
                             TranscriptPanel, DebugDrawer (every event, sent and received)
tools/probe.ts               Headless CLI client for protocol debugging
test/                        Vitest: resampler, transcript reducer, tools
```

★ marks the files you are most likely to change when building Polyglot.

## How a conversation flows

1. **Connect.** `App` calls `RealtimeClient.connect()`, which fetches `/api/token` and opens the WebSocket. When the socket opens, it sends `buildSessionConfig()` as a `session.update`, and the server replies with `session.created`, which echoes the resolved config.
2. **Speak.** `MicCapture` gets mic audio through an AudioWorklet, resamples it to 24 kHz PCM16, and sends `input_audio_buffer.append` about every 100 ms. Semantic VAD (`turn_detection: semantic_vad`) uses speech and end-of-turn context to decide when your turn ends, so the client never sends a commit.
3. **Model replies.** The server sends `response.created`, then a stream of `response.output_audio.delta` chunks (base64 PCM16), which go into the `RingPlayer`. Alongside them come `response.output_audio_transcript.delta` events with the text of what the model is saying. Your own words arrive later, in `conversation.item.input_audio_transcription.completed`.
4. **Barge-in.** If you talk over the model, the server sends `input_audio_buffer.speech_started`. The client flushes playback, measures how many milliseconds were actually heard, and sends `conversation.item.truncate`, so the model's memory of its turn matches what you heard.
5. **Tool calls.** `response.function_call_arguments.done` starts the handler right away through `tools/registry.ts`. When the turn's `response.done` arrives, the client sends one `function_call_output` per call and then a single `response.create`, and the model speaks the result.

### The transcript is a reducer

Events arrive out of display order. For example, your transcription can land after the model has already started replying. So `transcriptStore.ts` keeps an ordered map keyed by `item_id`, built by a pure function `(state, event, now) → state`. Every server event goes through it (`App` → `onServerEvent`). Tool results go through it too, as a synthetic event, `client.tool_result`. Because it is pure, `test/transcriptStore.test.ts` can replay a recorded session (`test/fixtures/three-turn.json`) and check the result.

## Audio format

PCM16, mono, 24 kHz in both directions (`AUDIO_RATE` in `sessionConfig.ts`). The playback `AudioContext` also runs at 24 kHz, so one API sample is exactly one speaker sample, and that is what makes the truncation timing in barge-in exact. Microphone input arrives at whatever rate the device uses (often 48 kHz) and is resampled in `capture.ts`.

## Where to make changes

| You want to… | Edit |
| --- | --- |
| Change the persona or teaching behaviour | `SYSTEM_PROMPT` in `src/realtime/sessionConfig.ts`. Keep it short; guidance for a specific tool goes in that tool's `description`. |
| Change the voice | `audio.output.voice` in `sessionConfig.ts` (`"default"`, a preset, or a cloned `voice_<id>`) |
| Tune turn-taking | `turn_detection` in `sessionConfig.ts` (`server_vad` or `semantic_vad`) |
| Add a tool | Add its schema to `tools/definitions.ts`, a handler to `tools/handlers.ts`, and register it in the `handlers` map. Return `{ summary, detail?, error? }`, where `summary` is what the model may say aloud. |
| Show tool results in the UI | Derive the view from the transcript state (tool items keep their `result`) instead of adding a second store |
| Change the layout | `src/App.tsx`, `src/ui/*`, `src/index.css` |

Transcription is set to `higgs-stt-3.1` with **no fixed language**, so code-switched speech is auto-detected. Don't add `language: "en"` back.

## Debugging

- **Debug drawer** (bottom of the page): shows every event sent and received, with its full JSON.
- **`npm run probe`**: opens a real session with no browser or audio hardware and prints every event. `--say "…"` generates speech for the text with Higgs TTS and streams it in like a microphone, which is a quick way to test code-switching:
  `npm run probe -- --say "Can you check my Korean? 저는 학생이에요."`
- **Close codes** are mapped to readable messages in `events.ts`: `3000` for an expired or invalid key, `4429` for billing, `1013` when the server is at capacity.
