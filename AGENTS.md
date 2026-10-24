# AGENTS.md

Onboarding notes for coding agents working in this repository. For human-facing setup, start with `README.md`. For the full event flow, see `docs/ARCHITECTURE.md`.

## Project

**Polyglot** is a real-time multilingual conversation partner for the [Boson AI Higgs Audio Hackathon](https://www.boson.ai/hackathon), Conversation as the Interface track. The learner speaks English, switches to Korean, French, or Japanese mid-sentence, and asks for corrections or explanations without breaking the conversation.

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

Use Node 20 or newer. A Boson API key is required for `dev` and `probe`, but not for `test`, `typecheck`, or `build`.

## Before calling a change done

Test a reasonable amount rather than exhaustively. These checks are sufficient for an issue and its PR:

- Always run `npm test && npm run typecheck && npm run build`.
- If you touched the prompt, session configuration, tools, or protocol, run `bash scripts/smoke.sh` once when a key is available. It drives `npm run probe` against the live API, so it also serves as the live check; unit tests do not cover server behavior. It must exit 0. If it fails, rerun it once before investigating; the `mixed` case is flaky until #57 is fixed. A `PENDING` line means an expected tool is not registered yet; when you add that tool, confirm that its case now passes.
- A pure rebase or conflict resolution with no behavior change needs only the first check.
- If you touched audio code under `src/audio/`, perform a listening test in the browser. Explicitly report when you could not do one.
- Unit tests should cover the new behavior: the normal case, one or two edge cases, and the error path. They do not need to be exhaustive.
- Do not repeat live runs to measure a rate, run smoke tests in parallel, or rehearse multi-branch merges unless someone asks.
- In the PR description, list each check you ran on one line. In an issue, write acceptance criteria as behavior plus "unit tests"; the live check is "one smoke run" or "a few probe runs", not a rate such as "8 of 10".

## Repository map

| File | Role |
| --- | --- |
| `src/realtime/sessionConfig.ts` | System prompt, voice, audio format, VAD, transcription, and tool list: the `session.update` payload |
| `src/realtime/RealtimeClient.ts` | WebSocket lifecycle, event routing, barge-in/truncation, and tool-call batching |
| `src/realtime/events.ts` | Server event names, client event builders, and close-code meanings |
| `src/tools/definitions.ts` | Tool JSON schemas sent to the model |
| `src/tools/handlers.ts` | Tool implementations |
| `src/tools/registry.ts` | `dispatch(name, args)`, shared by the browser and probe |
| `src/state/transcriptStore.ts` | Pure reducer: event stream to ordered transcript |
| `src/audio/` | Microphone capture/resampling to PCM16 and AudioWorklet playback |
| `src/App.tsx`, `src/ui/` | React UI; there is no state-management library |
| `server/index.ts` | Express token server; `/api/token` mints ephemeral keys |
| `tools/probe.ts` | Headless CLI client for debugging the protocol |

## Roadmap and workflow

The project is built in phases 0–5 across four tracks: A, conversation and model; B, tools; C, frontend; and D, infrastructure, avatar, and demo.

Read `docs/ROADMAP.md` before starting work. It contains the status table, claimable task checklists, file ownership by track, shared contracts, and per-phase exit criteria. When finishing a task, tick it and update the status table in the same PR. Record changes to shared contracts in the roadmap's decision log.

Respect the track ownership defined there. Shared files—especially `src/realtime/RealtimeClient.ts`, `src/realtime/events.ts`, and `src/state/transcriptStore.ts`—require the cross-track review described in the roadmap.

## Invariants: do not break these

- **The API key never reaches the browser.** The browser receives only short-lived `bai-eph-…` keys from `/api/token`. Never commit `.env` or any credential.
- **Transcription has no `language` field.** Omitting it allows automatic detection of code-switched speech. Do not add `language: "en"` back.
- **Audio is PCM16 mono at 24 kHz in both directions** (`AUDIO_RATE`). The playback `AudioContext` runs at the same rate, and barge-in truncation timing (`conversation.item.truncate`) depends on it.
- **Keep the system prompt short.** Upstream found that additional rules could prevent the model from calling tools. Put tool-specific guidance in the tool's `description`.
- **Tools never throw.** Handlers return `{ summary, detail?, error? }`. `summary` is suitable for speech. `registry.dispatch` must answer even for unknown tools because the model hangs if a `call_id` never receives a `function_call_output`.
- **Schema enums are hints.** Normalize model arguments such as case, plurals, and `ko-KR` to `ko`, following `normalizeLanguage` in `src/tools/handlers.ts`.
- **The transcript is the single source of truth.** Derive UI views from the transcript reducer instead of creating parallel stores. Local results enter through the synthetic `client.tool_result` event. Keep the reducer pure so it remains testable against `test/fixtures/`.
- **Unknown server events are logged and ignored**, never treated as fatal errors.
- **Leave React StrictMode enabled.** It helps expose duplicate WebSocket connection bugs during development.

## Adding a tool

1. Add its schema to `TOOL_DEFINITIONS` in `src/tools/definitions.ts`.
2. Add its handler to `src/tools/handlers.ts` and register it in the `handlers` map.
3. Add coverage in `test/tools.test.ts`.
4. Run `npm run probe -- --say "…"` to verify that the live model actually calls it.

## Code style

- Use strict TypeScript and ES modules.
- Match the existing comment style: explain *why*—protocol quirks and verified API behavior—not merely *what* the code does.
- Do not add dependencies without a clear reason.
- Use Vitest and keep tests under `test/`.
- Preserve the separation between React UI, the realtime client, pure state reduction, audio plumbing, and tool handlers.

## Licensing

Most code is adapted from [boson-ai/higgs-realtime-tutorial](https://github.com/boson-ai/higgs-realtime-tutorial) under Apache-2.0. Keep `NOTICE` and `LICENSES/` intact. Original code is under the MIT license in `LICENSE`.

## Hackathon context

- Judging weights: use of Higgs Audio 30%, user experience 25%, innovation 25%, and technical execution 20%. Higgs must remain central to the experience rather than serving only as final-stage TTS.
- Submission requires a public repository with a pinned commit SHA or tag and no credentials, a 2–3 minute demo video, and project write-ups. See the checklist in `README.md`.
- Other potentially useful Boson APIs include Higgs TTS (`POST /v1/audio/speech`, model `higgs-tts-3`, already used by the probe), voice cloning (`POST /v1/audio/voices`), and Higgs Avatar. Documentation: https://docs.boson.ai/llms.txt

## Git

- Ask before committing or pushing.
- Before you edit anything for a GitHub issue, create a branch for it from an up-to-date `main`, and never edit on `main` directly. Name it as the roadmap says, `phase<N>/<track>-<topic>`, using the issue's `phase-N` and `track:*` labels (for example `phase1/a-language-profiles`).
