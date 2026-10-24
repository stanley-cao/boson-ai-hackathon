# CLAUDE.md

Onboarding notes for coding agents working in this repo. For humans, start with `README.md`. For the full event flow, see `docs/ARCHITECTURE.md`.

## Project

**Polyglot** is a real-time multilingual conversation partner for the [Boson AI Higgs Audio Hackathon](https://www.boson.ai/hackathon), Conversation as the Interface track. The learner speaks English, switches to Korean, French or Japanese mid-sentence, and asks for corrections or explanations without breaking the conversation.

It is built on **Higgs Realtime** (`wss://api.boson.ai/v1/realtime`, model `higgs-realtime`), which speaks the OpenAI Realtime GA event protocol.

**Status: Phase 1 in progress** (see the status table in `docs/ROADMAP.md`). The tutor prompt is built from the language profiles in `src/lang/profiles.ts`, and the tutorial's dummy `web_search` tool has been removed in favour of the learning tools listed in the roadmap.

## Commands

```bash
npm install
cp .env.example .env     # BOSON_API_KEY=bai-...  (or BOSON_API_KEY_FILE=/path)
npm run dev              # token server :3000 + Vite :5173 (open :5173)
npm test                 # vitest
npm run typecheck        # tsc -b --noEmit
npm run build
npm run probe            # headless live session, prints every event (needs key)
npm run probe -- --say "Can you check my Korean? 저는 학생이에요."   # TTS-synthesised spoken turn
```

Node 20+. A Boson API key is needed for `dev` and `probe`. It isn't needed for `test`, `typecheck` or `build`.

## Before calling a change done

Test a reasonable amount, not exhaustively. These checks are enough for an issue and its PR:

- Always run `npm test && npm run typecheck && npm run build`.
- If you touched the prompt, session config, tools or protocol, run `bash scripts/smoke.sh` once when a key is available. It drives `npm run probe` against the live API, so it's also the live check; unit tests don't cover server behaviour. It must exit 0. If it fails, rerun it once before digging in. A `PENDING` line means an expected tool isn't registered yet; when you add that tool, check that its case now passes.
- A pure rebase or conflict resolution with no behaviour change needs only the first check.
- If you touched audio (`src/audio/`), it needs a listening test in the browser. Say so if you couldn't do one.
- Unit tests cover the new behaviour: the normal case, an edge case or two, and the error path. They don't need to be exhaustive.
- Don't repeat live runs to measure a rate, run smoke in parallel, or rehearse multi-branch merges unless someone asks.
- In the PR description, give one line per check you ran. In an issue, write acceptance criteria as behaviour plus "unit tests"; the live check is "one smoke run" or "a few probe runs", not a rate such as "8 of 10".

## Map

| File | Role |
| --- | --- |
| `src/realtime/sessionConfig.ts` | System prompt, voice, audio format, VAD, transcription, tool list: the `session.update` payload |
| `src/realtime/RealtimeClient.ts` | WebSocket lifecycle, event routing, barge-in/truncation, tool-call batching |
| `src/realtime/events.ts` | Server event names, client event builders, close-code meanings |
| `src/tools/definitions.ts` | Tool JSON schemas sent to the model |
| `src/tools/handlers.ts` | Tool implementations |
| `src/tools/registry.ts` | `dispatch(name, args)`, shared by the browser and the probe |
| `src/state/transcriptStore.ts` | Pure reducer: event stream → ordered transcript |
| `src/audio/` | Mic capture/resample → PCM16, and AudioWorklet playback |
| `src/App.tsx`, `src/ui/` | React UI (no state library) |
| `server/index.ts` | Express token server: `/api/token` mints ephemeral keys |
| `tools/probe.ts` | Headless CLI client for debugging the protocol |

## Roadmap and workflow

The project is built in phases (0–5) across four tracks (A: conversation and model, B: tools, C: frontend, D: infra, avatar and demo). **Read `docs/ROADMAP.md` before starting work.** It has the status table, the claimable task checklists, the file ownership per track, the shared contracts, and the per-phase exit criteria. When you finish a task, tick it and update the status table in the same PR. Record any change to a shared contract in its decision log.

## Invariants: don't break these

- **The API key never reaches the browser.** The browser only gets short-lived `bai-eph-…` keys from `/api/token`. Never commit `.env` or any key.
- **Transcription has no `language` field.** That is what lets code-switched speech be auto-detected. Don't add `language: "en"` back.
- **Audio is PCM16 mono at 24 kHz both ways** (`AUDIO_RATE`). The playback `AudioContext` runs at the same rate, and the barge-in truncation timing (`conversation.item.truncate`) depends on that.
- **Keep the system prompt short.** Upstream found that extra rules stopped the model calling tools. Guidance for a specific tool goes in that tool's `description`.
- **Tools never throw.** Handlers return `{ summary, detail?, error? }`. `summary` is what the model may say aloud. `registry.dispatch` answers even for unknown tools, because the model hangs if a `call_id` never gets a `function_call_output`.
- **Schema enums are hints.** Normalise model arguments (case, plurals, `ko-KR` → `ko`), as `normalizeLanguage` in `handlers.ts` does.
- **One transcript source of truth.** Derive UI views from the transcript reducer, not from parallel stores. Local results enter it as the synthetic `client.tool_result` event. Keep the reducer pure so it stays testable against `test/fixtures/`.
- **Unknown server events are logged and ignored**, never thrown on.
- **Leave React StrictMode on.** It catches double-socket bugs in development.

## Adding a tool

1. Add the schema to `TOOL_DEFINITIONS` in `src/tools/definitions.ts`.
2. Add a handler to `src/tools/handlers.ts` and register it in the `handlers` map.
3. Add tests in `test/tools.test.ts`.
4. Check with `npm run probe -- --say "…"` that the model actually calls it.

## Style

- TypeScript in strict mode, with ES modules.
- Match the existing comment style: explain *why* (protocol quirks, verified API behaviour), not *what*.
- Don't add dependencies without a clear reason.
- Write tests with vitest, and keep them in `test/`.

## Licensing

Most of the code is adapted from [boson-ai/higgs-realtime-tutorial](https://github.com/boson-ai/higgs-realtime-tutorial) (Apache-2.0). Keep `NOTICE` and `LICENSES/` intact. Original code is under MIT (`LICENSE`).

## Hackathon context

- Judging: use of Higgs Audio 30%, user experience 25%, innovation 25%, technical execution 20%. Higgs has to be central to the experience, not just the final TTS layer.
- Submission: a public repo with a pinned commit SHA or tag and no credentials, plus a 2–3 minute demo video and write-ups. See the checklist in `README.md`.
- Other Boson APIs that may be useful: Higgs TTS (`POST /v1/audio/speech`, model `higgs-tts-3`, already used by the probe), voice cloning (`POST /v1/audio/voices`), and Higgs Avatar. Docs: https://docs.boson.ai/llms.txt

## Git

- Ask before committing or pushing.
- Before you edit anything for a GitHub issue, create a branch for it from an up-to-date `main`, and never edit on `main` directly. Name it as the roadmap says, `phase<N>/<track>-<topic>`, using the issue's `phase-N` and `track:*` labels (for example `phase1/a-language-profiles`).
