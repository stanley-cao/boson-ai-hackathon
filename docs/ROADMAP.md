# Roadmap

How Polyglot goes from the template to a multilingual voice tutor with an avatar, split so that four or more people can work in parallel. **Agents and teammates: read `CLAUDE.md` first, then this file.**

## Status

Update this table in the same PR that finishes a task or a phase.

| Phase | Goal | Status | Lead | PRs |
| --- | --- | --- | --- | --- |
| 0 | Ground truth: does Higgs handle Mandarin and code-switching? | ⬜ not started | | |
| 1 | English + Mandarin MVP for live testing | 🟨 in progress | | |
| 2 | Depth and polish (levels, TTS replay, recap) | ⬜ not started | | |
| 3 | More languages; LiveKit spike to de-risk the avatar | ⬜ not started | | |
| 4 | Higgs Avatar (realtime, via LiveKit) | ⬜ not started | | |
| 5 | Demo video and submission | ⬜ not started | | |

Status values: ⬜ not started · 🟨 in progress · ✅ done · ⛔ blocked (say why in the decision log).

## How to pick up work

1. Read `CLAUDE.md` (commands, invariants) and `docs/ARCHITECTURE.md` (event flow).
2. Find the earliest phase that isn't ✅, and pick an unclaimed `[ ]` task **in your track**. Tasks in later phases are fair game only if they're marked *parallel*.
3. Feature tasks have a GitHub issue (`#N`): claim one by **assigning yourself on the issue** (`#N` on each task). Filter the [issues](https://github.com/stanley-cao/boson-ai-hackathon/issues) by `phase-N`, `track:*` and `size:*` labels, or by milestone. Check the issue's "Depends on" section first. Tasks with no issue number (research, testing, submission) are claimed in the team chat.
4. Branch as `phase<N>/<track>-<topic>`, for example `phase1/b-correction-tool`.
5. Before opening a PR, run that phase's **Verification** steps. Paste the results into the PR description.
6. Put `Closes #N` in the PR description. In the same PR, tick the box (`[x]`) and update the status table. Get one review from someone on a different track.
7. If you change a **shared contract**, tag every track on the PR and add a line to the decision log.

A phase is ✅ only when its **exit criteria** are met in a live session, not just when every box is ticked.

## Tracks and file ownership

Each file has one owning track, which keeps merge conflicts rare. If you need to edit a file another track owns, pair with that track or ask them first.

| Track | Focus | Owns |
| --- | --- | --- |
| **A: Conversation and model** | Prompt, language profiles, VAD, voice behaviour | `src/realtime/sessionConfig.ts`, `src/lang/`, prompt tests in `test/` |
| **B: Tools and learning data** | Tool schemas, handlers, study data | `src/tools/*`, `src/state/study.ts`, `test/tools.test.ts` |
| **C: Frontend and UX** | Everything the learner sees | `src/App.tsx`, `src/ui/*`, `src/index.css` |
| **D: Infra, avatar and demo** | Server, probe and smoke tests, LiveKit and avatar, submission | `server/`, `livekit/`, `tools/probe.ts`, `scripts/`, `README.md` |

Shared files (`src/realtime/RealtimeClient.ts`, `src/realtime/events.ts`, `src/state/transcriptStore.ts`) change only through a PR reviewed by two tracks.

## Shared contracts

Agree on these first. Changing them requires a decision-log entry.

1. **Language profiles.** `src/lang/profiles.ts` (Track A):
   ```ts
   interface LanguageProfile {
     code: "en" | "zh" | "ko" | "fr" | "ja";  // BCP-47 base
     name: string;                            // "Mandarin Chinese"
     script: "Latn" | "Hans" | "Hang" | "Jpan";
     romanization?: "pinyin" | "revised" | "hepburn";
     promptNotes: string;                     // short teaching notes (tones, measure words…)
     sampleOpeners: string[];                 // used by the UI and the smoke tests
   }
   export const ACTIVE_PAIR = { native: "en", target: "zh" };
   ```
   The system prompt is *built from* the profile, so adding a language is a data change, not a code change.
2. **Tool results.** `ToolResult { summary, detail?, error? }` (already in `src/tools/handlers.ts`). `summary` is spoken. `detail` is typed in `src/tools/types.ts` (Track B): `Correction`, `Phrase`, `PronunciationNote`, `PracticeLanguage`. Track C renders only from these types.
3. **One source of truth for the UI.** The UI reads the transcript reducer (`src/state/transcriptStore.ts`) and views derived from it (`src/state/study.ts`). Tool results enter as the synthetic `client.tool_result` event. Don't add parallel stores.
4. **Portable config.** The prompt and tool schemas are plain data, exported by `npm run export-config` → `shared/session.json`, so the Python LiveKit agent (Phase 3–4) uses exactly the same prompt and tools as the browser.

---

## Phase 0: Ground truth

*About half a day. Every track does its task.*

- [ ] **All:** add `BOSON_API_KEY` to `.env`, run `npm run dev`, and have a short conversation with the template.
- [ ] **D:** run `npm run probe -- --say "我想练习中文, can you help me?"` and a pure-Mandarin and a pure-English utterance, and save the output as fixtures in `test/fixtures/`. Record in `docs/FINDINGS.md`:
  - Does `higgs-stt-3.1` transcribe Mandarin, and mixed English/Mandarin?
  - Does the server report a detected language?
  - Is the output in Simplified or Traditional characters?
  - Roughly how long is the response latency?
- [x] **A:** compare 3 code-switching prompt variants with the probe: (a) mirror the learner's mix, (b) mostly the target language with English scaffolding, (c) the learner chooses. Record the winner in the decision log.
- [ ] **C:** do a UI sketch (transcript, study panel, practice-language badge, and space reserved for the avatar video). Put a screenshot or ASCII sketch in the PR.

**Exit criteria:** `FINDINGS.md` gives a go or no-go on Mandarin transcription. If transcription is weak, we still go ahead: the model understands the audio regardless. We show the model's own text and label user transcripts "approximate".

**Verification:** the fixtures are committed and `npm test` passes.

## Phase 1: English + Mandarin MVP

- [x] **A:** `src/lang/profiles.ts` with `en` and `zh`, and `ACTIVE_PAIR = { native: "en", target: "zh" }`. (#5) (@KyleDong03)
- [x] **A:** generate the tutor system prompt from the profile. It should cover a short persona, following code-switches without asking the learner to pick a language, one correction per turn, and pinyin with tone marks in tool calls. **Keep it short** (see `CLAUDE.md`). (#6)
- [ ] **A:** compare `semantic_vad` with `server_vad` for learners who pause mid-sentence, and record the choice. (#7)
- [x] **B:** `src/tools/types.ts` with the `detail` types. (#8)
- [ ] **B:** replace `web_search` with (#10, #11, #12, #13):
  - [x] `note_correction {language, said, correct, explanation, kind, romanization}` (#10)
  - [ ] `save_phrase {language, phrase, meaning, romanization, note}` (#11)
  - [ ] `pronunciation_feedback {language, target, romanization, issue: "tone"|"initial"|"final"|"other", tip}`: tone feedback is the Mandarin showcase. (#12)
  - [ ] `set_practice_language {language, level}` (#13)
- [x] **B:** normalise language arguments ("Mandarin", "Chinese", "zh-CN", "ZH" → `zh`), as `normalizeTopic` does. Handlers never throw. Add unit tests for every tool. (#9) (@KyleDong03)
- [x] **B:** `src/state/study.ts`, which derives corrections, phrases and pronunciation notes from the transcript. (#14) (@dorsa-molaverdikhani)
- [x] **C:** a language-tagged transcript that colours Han versus Latin runs. (#15) (@lanazgonjanin)
- [x] **C:** pinyin shown under Han text when a tool supplied it. (#16) (@dorsa-molaverdikhani)
- [x] **C:** a study panel with correction, phrase and pronunciation cards. It must work at phone width. (#17) (@dorsa-molaverdikhani)
- [x] **C:** a "practising: 中文" badge driven by the latest practice-language tool result. (#18) (@KyleDong03)
- [x] **D:** `scripts/smoke.sh`, which runs probe utterances (English, Mandarin, mixed, and a request for tone feedback) and asserts that the expected tool calls fire. Add it to the "done" checklist in `CLAUDE.md`. (#19) (@KyleDong03)
- [ ] **All:** Phase 1 live acceptance session with a Mandarin speaker, against the exit criteria below

**Exit criteria:** a live conversation of about 3 minutes, mixing English and Mandarin, in which the tutor (1) corrects at least one mistake, (2) gives tone feedback, (3) saves a phrase, and (4) is never derailed by a mid-sentence switch.

**Verification:** `npm test && npm run typecheck && npm run build`, then `scripts/smoke.sh`, then a live session with a Mandarin speaker.

## Phase 2: Depth and polish

- [ ] **A:** a learner level (beginner or intermediate) that adapts speed and scaffolding, and support for "say that again slowly". (#21)
- [ ] **A:** after a correction, the tutor repeats the target word clearly so the learner hears it. (#22)
- [ ] **B:** explain-phrase flow: the learner asks "what does 加油 mean?", and the tutor explains and saves it. (#23)
- [ ] **B:** session summary data (counts and phrases to review), saved to `localStorage` with try/catch so it survives a reload. (#24)
- [ ] **D + C:** a `POST /api/tts` server route that calls Higgs TTS (`/v1/audio/speech`, `higgs-tts-3`) with the key kept server-side, and a replay button on study cards. (#25, #26)
- [ ] **C:** an end-of-session recap screen. (#27)
- [ ] **D:** choose a voice that handles Mandarin well (`audio.output.voice`, from the voice library), and add friendly error messages for close codes 3000, 4429 and 1013. (#28)

**Exit criteria:** a beginner can hold a slow conversation, replay any saved phrase, and see a recap at the end.

**Verification:** as in Phase 1, plus a check that the replay route never exposes the key (check the browser's network tab).

## Phase 3: More languages, and de-risking the avatar

- [ ] **A:** add `ko`, `fr` and `ja` profiles as config only, and a language picker (Track C wires up the UI). (#29)
- [ ] **A:** test switching across three languages in one session (English, then 中文, then 한국어). (#29)
- [ ] **A:** `npm run export-config` writes the prompt and tool schemas to `shared/session.json` for the LiveKit agent (#30)
- [ ] **D (parallel, start during Phase 1–2):** a LiveKit spike (#31):
  - Copy `livekit/` from [higgs-realtime-tutorial](https://github.com/boson-ai/higgs-realtime-tutorial) (Apache-2.0) and extend `NOTICE` to cover it.
  - Create a LiveKit Cloud project. Self-hosted LiveKit is refused by the avatar API.
  - Load `shared/session.json` in the agent.
  - Get a voice-only conversation working through LiveKit.
- [ ] **B:** make tool execution transport-agnostic. In LiveKit mode the agent receives the tool calls and forwards them to the browser over a LiveKit data channel or RPC. The browser runs `registry.dispatch` and returns the result, so the study panel works unchanged. (#32)

**Exit criteria:** the same conversation, with working tools and study panel, runs both in direct-WebSocket mode and through LiveKit.

**Verification:** as in Phase 1, plus `livekit/probe.py` passes.

## Phase 4: Avatar

Realtime Higgs Avatar runs only inside a **LiveKit Cloud** room. Our agent relays the Higgs Realtime audio to it, and the browser never calls Boson directly. See the [realtime sessions docs](https://docs.boson.ai/models/higgs-avatar/realtime-sessions.md).

- [ ] **D:** server endpoints (#33):
  - Mint LiveKit tokens for the browser, the agent and the avatar.
  - `POST /v1/avatar/sessions` (`avatar_id` such as `builtin_claire_v1`, with `publisher_identity` set to the agent).
  - `DELETE` the session when the user leaves.
  - On `429 capacity_exhausted`, honour `Retry-After`.
- [ ] **D:** the agent forwards `response.output_audio.delta` to the avatar over a LiveKit data stream, and tells the avatar to drop unplayed audio on barge-in. (#34)
- [ ] **C:** an avatar mode using `livekit-client`: join the room, publish the mic, and attach the avatar's video and audio tracks, with the transcript and study panel beside the video. (#35)
- [ ] **C:** keep direct-WebSocket mode as a **fallback** behind a toggle, in case avatar capacity or latency is a problem. (#35)
- [ ] **A:** tune the prompt for an on-screen tutor (shorter turns, more expressive delivery). (#35)
- [ ] **Fallback, only if realtime is blocked:** pre-render intro and recap clips with `POST /v1/videos/stream` (fragmented MP4 from a still image and TTS text). (#33)

**Exit criteria:** a lip-synced avatar tutor holds the Phase 1 conversation, and barge-in stops the avatar mid-sentence.

**Verification:** the session reaches `active`, and is `terminated` after leaving (check with `GET /v1/avatar/sessions/{id}`). Plus a live session.

## Phase 5: Demo and submission

Track D leads, and everyone contributes.

- [ ] Script the 2–3 minute demo: English → Mandarin mid-sentence → correction and tone feedback → saved phrase and TTS replay → switch to Korean → avatar on screen.
- [ ] Record the video and upload it publicly, with no request-access step.
- [ ] Update `README.md` with full setup (including LiveKit), and add a known-limitations section.
- [ ] Write the two write-ups of up to 200 words each: (1) what Polyglot is, (2) how each Higgs model is used and what is technically hard. Add team info with GitHub handles.
- [ ] Check that no keys are anywhere in the git history (`git log -p | grep -i "bai-"`).
- [ ] Tag the judged commit, `git tag v1.0-submission && git push --tags`, and put the SHA in the form.

Map the demo to the judging weights: **use of Higgs 30%** (realtime code-switching, tools during speech, TTS replay, avatar), **UX 25%**, **innovation 25%**, **technical execution 20%**.

**Exit criteria:** the submission form is filed with the video, the repo, and the tag.

---

## Day-1 starter PRs

1. **A:** `src/lang/profiles.ts` (`en` and `zh`), with the prompt built from it.
2. **B:** `src/tools/types.ts`, plus the four tool schemas with stub handlers and tests.
3. **C:** a study panel shell rendering mocked `detail` data.
4. **D:** `docs/FINDINGS.md` from the Phase 0 probe runs, then `scripts/smoke.sh`.

## Decision log

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-23 | Mandarin is the first target language, paired with English. | The team chose it. Tone feedback makes a strong showcase, and Han vs. Latin text makes code-switches visible. |
| 2026-10-23 | Realtime avatar requires LiveKit Cloud, so the prompt and tools stay portable (`shared/session.json`), and a LiveKit spike starts during Phase 1–2. | Higgs Avatar realtime sessions only join LiveKit Cloud rooms, so the browser-direct WebSocket can't drive the avatar. |
| 2026-10-23 | Transcription uses no fixed language. | A fixed language breaks transcription of code-switched speech. |
| 2026-10-23 | Tool `detail` types live in `src/tools/types.ts`, each with a `type` discriminant; `LanguageCode` is defined there for `src/lang/profiles.ts` to import. Correction `kind`: grammar / vocabulary / other. Practice `level`: beginner / intermediate. | Lets `study.ts` and the UI narrow details safely, and keeps one language-code union. |
| 2026-10-23 | Provisionally use `semantic_vad` with Boson's default parameters; keep #7 open pending a live comparison. | Semantic end-of-turn judgement is designed to preserve natural pauses while learners search for words. Validate it against `server_vad` with English, Mandarin and code-switched speech before considering the decision final. |
| 2026-10-23 | `LanguageCode` is declared once, in `src/lang/profiles.ts`; `src/tools/types.ts` re-exports it, and `ToolResult.detail` is typed as `ToolDetail`. Supersedes the 2026-10-23 entry that put the union in `types.ts`. | The profiles landed with their own copy of the union, and two copies drift. Typing `detail` means a handler can only hand the study panel a shape it renders. |
| 2026-10-23 | Learning tools are described as "call this FIRST, before you say anything", and their `summary` tells the model what to say next. | Probed live with the tutor prompt: "call this in the same turn as you correct" got `note_correction` called in 9 of 37 runs; "call this first" got it called in 24 of 24. |
| 2026-10-24 | Provisionally keep code-switching variant (a), "follow the switch and reply in the language they just used"; keep #6 open. | Probed live, 3 runs per variant of the same three spoken turns (English-first mixed, pure Mandarin, English request plus a sentence with a measure-word error). (a) replied in English to the pure-Mandarin turn in 2 of 3 runs. (b) "mostly target language" stayed in Mandarin there 3 of 3, but dropped English from the mixed correction turn 3 of 3. (c) "learner chooses" asked which language to use in 2 of 3 runs, which #6 rules out. `note_correction` fired on the error turn in only 1 of 9 runs, although the transcript showed the error in at least 7, so no variant meets #6 yet. |
| 2026-10-24 | Code-switching uses an explicit mirror, "when they speak Mandarin, answer in Mandarin; when they speak English, answer in English", with corrections explained in English. Pinyin is asked for only in tool arguments. Supersedes the provisional 2026-10-24 entry; closes #6. | Earlier runs were skewed by a probe bug: when semantic VAD split a turn, the probe moved on before the reply to the rest of it, so the "1 of 9" `note_correction` figure was largely an artifact (fixed in `tools/probe.ts`). With the fix, 3 to 4 runs per variant of the same three spoken turns: (a) answered the pure-Mandarin turn in English 3 of 3; a "Mandarin by default" hybrid called `note_correction` 0 of 3 and spoke pinyin; the explicit mirror with the profile's unscoped "write … with pinyin" note removed answered Mandarin in characters 4 of 4, but went all-Mandarin on the correction turn; adding "explain corrections in English" and dropping "after answering" (which contradicted the tool's "call this FIRST") kept English there 3 of 4 and fired the tool 2 of 4 spoken, 4 of 4 typed. The spoken misses trace to input: TTS-synthesised Mandarin inside English is often mis-transcribed (我有三个狗 → "where your fingers go"), and VAD splits "Can you check this sentence?" from the sentence (#7). |
