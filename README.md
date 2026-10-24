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

## LiveKit mode (spike)

The same tutor as a [LiveKit Agents](https://docs.livekit.io/agents/) worker, which is the path to Higgs Avatar (Phase 4). It reads its prompt, voice, VAD, transcription and tool schemas from `shared/session.json` (`npm run export-config`). Tool calls are only logged for now; forwarding them to the browser's study panel is #32. It needs [uv](https://docs.astral.sh/uv/) and a [LiveKit Cloud](https://cloud.livekit.io) project: the avatar refuses self-hosted LiveKit.

```bash
cd livekit
cp .env.example .env      # BOSON_API_KEY plus the LiveKit Cloud URL, key and secret
uv sync
uv run agent.py dev       # join rooms; talk to it in the LiveKit Agents Playground
                          # (or from the repo root: npm run dev:agent)
uv run probe.py --say "What does 加油 mean?"   # headless: joins a room, types a turn, prints replies
uv run pytest             # unit tests, no keys needed
```

Avatar mode in the app needs this agent running too: `npm run dev:avatar` starts the token server, Vite and the agent together. Without the agent, avatar mode reports `agent_not_running` and switches to voice only. The agent tutors in the language and level picked in the app, using the prompts exported to `shared/prompts.json`.

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
| `shared/session.json`, `shared/prompts.json` | The session config, and the prompt per language and level, exported for the LiveKit agent (`npm run export-config`) |
| `livekit/` | Python LiveKit voice agent and its probe |

## Credits

The realtime client, audio pipeline, token server, probe and LiveKit agent are adapted from Boson AI's [higgs-realtime-tutorial](https://github.com/boson-ai/higgs-realtime-tutorial) (Apache-2.0, commit `87f1ae8`). See `NOTICE` and `LICENSES/`.

## Submission checklist

- [ ] 2–3 min public demo video
- [ ] Public repo, pin the commit SHA / tag for judging, no keys committed
- [ ] Write-ups: project (≤200 words), how it was built (≤200 words), team and known limitations. Drafts of the first two are in [docs/SUBMISSION.md](docs/SUBMISSION.md).
