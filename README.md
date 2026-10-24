# Polyglot

A real-time multilingual conversation partner for the [Higgs Audio Hackathon](https://www.boson.ai/hackathon) (Conversation as the Interface track). Speak English, switch to Korean or French mid-sentence, and ask for corrections or explanations without breaking the conversation.

Built on [Higgs Realtime](https://docs.boson.ai/models/higgs-realtime/overview) (`wss://api.boson.ai/v1/realtime`, OpenAI Realtime-compatible protocol).

## Setup

Requires Node 20+ and a Boson API key (claim hackathon credits at boson.ai → Workspace → API keys).

```bash
npm install
cp .env.example .env    # set BOSON_API_KEY=bai-...
npm run dev
```

Open http://localhost:5173, click **Connect**, then **Start microphone**.

`npm run dev` runs a small token server on :3000, which mints short-lived ephemeral keys so your real key never reaches the browser, and the Vite dev server on :5173.

## Commands

```bash
npm test           # unit tests (vitest)
npm run typecheck
npm run build
npm run probe -- --say "hello there"   # headless session, prints every event
```

## Layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together and where to make changes. See [docs/ROADMAP.md](docs/ROADMAP.md) for the build plan, phases, and who owns what.

| Path | What |
| --- | --- |
| `server/index.ts` | Token server: `/api/token` → `POST /v1/realtime/client_secrets` |
| `src/realtime/sessionConfig.ts` | System prompt, voice, audio format, VAD, transcription, tools |
| `src/realtime/RealtimeClient.ts` | WebSocket client, mic/playback, barge-in, tool-call loop |
| `src/tools/` | Tool definitions (JSON schema) and client-side handlers (starter's dummy web search) |
| `src/state/` | Transcript reducer (event stream → ordered turns) |
| `src/ui/` | React components |
| `tools/probe.ts` | Headless debugging client (uses Higgs TTS to "speak" test turns) |

## Credits

The realtime client, audio pipeline, token server and probe are adapted from Boson AI's [higgs-realtime-tutorial](https://github.com/boson-ai/higgs-realtime-tutorial) (Apache-2.0, commit `87f1ae8`). See `NOTICE` and `LICENSES/`.

## Submission checklist

- [ ] 2–3 min public demo video
- [ ] Public repo, pin the commit SHA / tag for judging, no keys committed
- [ ] Write-ups: project (≤200 words), how it was built (≤200 words), team and known limitations
