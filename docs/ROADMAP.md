# Roadmap

How Polyglot goes from the template to a multilingual voice tutor with an avatar, split so that four or more people can work in parallel. **Agents and teammates: read `CLAUDE.md` first, then this file.**

## Status

Update this table in the same PR that finishes a task or a phase.

| Phase | Goal | Status | Lead | PRs |
| --- | --- | --- | --- | --- |
| 0 | Ground truth: does Higgs handle Mandarin and code-switching? | ⬜ not started | | |
| 1 | English + Mandarin MVP for live testing | 🟨 in progress | | |
| 2 | Depth and polish (levels, TTS replay, recap) | 🟨 in progress | | |
| 3 | More languages; LiveKit spike to de-risk the avatar | 🟨 in progress | | |
| 4 | Higgs Avatar (realtime, via LiveKit) | 🟨 in progress | | |
| 5 | Demo video and submission | ⬜ not started | | |

Status values: ⬜ not started · 🟨 in progress · ✅ done · ⛔ blocked (say why in the decision log).

## How to pick up work

1. Read `CLAUDE.md` (commands, invariants) and `docs/ARCHITECTURE.md` (event flow).
2. Find the earliest phase that isn't ✅, and pick an unclaimed `[ ]` task **in your track**. Tasks in later phases are fair game only if they're marked *parallel*.
3. Feature tasks have a GitHub issue (`#N`): claim one by **assigning yourself on the issue** (`#N` on each task). Filter the [issues](https://github.com/stanley-cao/polyglot/issues) by `phase-N`, `track:*` and `size:*` labels, or by milestone. Check the issue's "Depends on" section first. Tasks with no issue number (research, testing, submission) are claimed in the team chat.
4. Branch as `phase<N>/<track>-<topic>`, for example `phase1/b-correction-tool`.
5. Before opening a PR, run the checks in `CLAUDE.md` ("Before calling a change done") and list them in the PR description. A phase's **Verification** steps are for its exit, not for every PR.
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
     code: "en" | "zh" | "ko" | "fr" | "ja" | "sr";  // BCP-47 base
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
- [x] **A:** compare `semantic_vad` with `server_vad` for learners who pause mid-sentence, and record the choice. (#7)
- [x] **B:** `src/tools/types.ts` with the `detail` types. (#8)
- [x] **B:** replace `web_search` with (#10, #11, #12, #13):
  - [x] `note_correction {language, said, correct, explanation, kind, romanization}` (#10)
  - [x] `save_phrase {language, phrase, meaning, romanization, note}` (#11)
  - [x] `pronunciation_feedback {language, target, romanization, issue: "tone"|"initial"|"final"|"other", tip}`: tone feedback is the Mandarin showcase. (#12)
  - [x] `set_practice_language {language, level: "beginner"|"intermediate"|"advanced"}` (#13)
- [x] **B:** normalise language arguments ("Mandarin", "Chinese", "zh-CN", "ZH" → `zh`), as `normalizeTopic` does. Handlers never throw. Add unit tests for every tool. (#9) (@KyleDong03)
- [x] **B:** `src/state/study.ts`, which derives corrections, phrases and pronunciation notes from the transcript. (#14) (@dorsa-molaverdikhani)
- [x] **C:** a language-tagged transcript that colours Han versus Latin runs. (#15) (@lanazgonjanin)
- [x] **C:** pinyin shown under Han text when a tool supplied it. (#16) (@dorsa-molaverdikhani)
- [x] **C:** a study panel with correction, phrase and pronunciation cards. It must work at phone width. (#17) (@dorsa-molaverdikhani)
- [x] **C:** a "practising: 中文" badge driven by the latest practice-language tool result. (#18) (@KyleDong03)
- [x] **D:** `scripts/smoke.sh`, which runs probe utterances (English, Mandarin, mixed, and a request for tone feedback) and asserts that the expected tool calls fire. Add it to the "done" checklist in `CLAUDE.md`. (#19) (@KyleDong03)
- [ ] **All:** Phase 1 live acceptance session with a Mandarin speaker, against the exit criteria below

**Exit criteria:** a live conversation of about 3 minutes, mixing English and Mandarin, in which the tutor (1) corrects at least one mistake, (2) gives tone feedback, (3) saves a phrase, and (4) is never derailed by a mid-sentence switch.

**Verification:** `npm test && npm run build`, then a live session with a Mandarin speaker.

## Phase 2: Depth and polish

- [x] **A:** a learner level (beginner or intermediate) that adapts speed and scaffolding, and support for "say that again slowly". (#21) (@dorsa-molaverdikhani)
- [x] **A:** after a correction, the tutor repeats the target word clearly so the learner hears it. (#22) (@lanazgonjanin)
- [x] **B:** explain-phrase flow: the learner asks "what does 加油 mean?", and the tutor explains and saves it. (#23) (@KyleDong03)
- [x] **B:** session summary data (counts and phrases to review), saved to `localStorage` with try/catch so it survives a reload. (#24) (@dorsa-molaverdikhani)
- [x] **D:** a `POST /api/tts` server route that calls Higgs TTS (`/v1/audio/speech`, `higgs-tts-3`) with the key kept server-side. (#25) (@lanazgonjanin)
- [x] **C:** a replay button on study cards. (#26) (@stanley-cao)
- [x] **C:** an end-of-session recap screen. (#27) (@dorsa-molaverdikhani)
- [x] **D:** choose a voice that handles Mandarin well (`audio.output.voice`, from the voice library), and add friendly error messages for close codes 3000, 4429 and 1013. (#28) (@lanazgonjanin)

**Exit criteria:** a beginner can hold a slow conversation, replay any saved phrase, and see a recap at the end.

**Verification:** as in Phase 1, plus a check that the replay route never exposes the key (check the browser's network tab).

## Phase 3: More languages, and de-risking the avatar

- [x] **A:** add `ko`, `fr` and `ja` profiles as config only, and a language picker (Track C wires up the UI). (#29) — @dorsa-molaverdikhani
- [x] **A:** add an `sr` (Serbian) profile, written in Latin script like French. (#86) — @dorsa-molaverdikhani
- [ ] **A:** test switching across three languages in one session (English, then 中文, then 한국어). (#29)
- [x] **A:** `npm run export-config` writes the prompt and tool schemas to `shared/session.json` for the LiveKit agent (#30)
- [x] **D (parallel, start during Phase 1–2):** a LiveKit spike (#31):
  - [x] Copy `livekit/` from [higgs-realtime-tutorial](https://github.com/boson-ai/higgs-realtime-tutorial) (Apache-2.0) and extend `NOTICE` to cover it.
  - [x] Create a LiveKit Cloud project. Self-hosted LiveKit is refused by the avatar API.
  - [x] Load `shared/session.json` in the agent. Tool calls get a stand-in result until #32.
  - [x] Get a voice-only conversation working through LiveKit.
- [x] **B:** make tool execution transport-agnostic. In LiveKit mode the agent receives the tool calls and forwards them to the browser over a LiveKit data channel or RPC. The browser runs `registry.dispatch` and returns the result, so the study panel works unchanged. (#32) (@KyleDong03)

**Exit criteria:** the same conversation, with working tools and study panel, runs both in direct-WebSocket mode and through LiveKit.

**Verification:** as in Phase 1, plus `livekit/probe.py` passes.

## Phase 4: Avatar

Realtime Higgs Avatar runs only inside a **LiveKit Cloud** room. Our agent relays the Higgs Realtime audio to it, and the browser never calls Boson directly. See the [realtime sessions docs](https://docs.boson.ai/models/higgs-avatar/realtime-sessions.md).

- [x] **D:** server endpoints (#33) (@KyleDong03):
  - Mint LiveKit tokens for the browser, the agent and the avatar.
  - `POST /v1/avatar/sessions` (`avatar_id` such as `builtin_claire_v1`, with `publisher_identity` set to the agent).
  - `DELETE` the session when the user leaves.
  - On `429 capacity_exhausted`, honour `Retry-After`.
- [ ] **D:** the agent forwards `response.output_audio.delta` to the avatar over a LiveKit data stream, and tells the avatar to drop unplayed audio on barge-in. (#34) — implementation ready; live validation pending
- [x] **C:** an avatar mode using `livekit-client`: join the room, publish the mic, and attach the avatar's video and audio tracks, with the transcript and study panel beside the video. (#35) (@stanley-cao)
- [x] **C:** keep direct-WebSocket mode as a **fallback** behind a toggle, in case avatar capacity or latency is a problem. (#35) (@stanley-cao)
- [x] **A:** tune the prompt for an on-screen tutor (shorter turns, more expressive delivery). (#35) (@stanley-cao)
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
| 2026-10-24 | In server-created `polyglot-*` rooms, `livekit/agent.py` installs LiveKit Agents' `DataStreamAudioOutput` as the session audio sink, targeting `polyglot-avatar` at 24 kHz and waiting for its audio track (#34). Other rooms keep the normal audio track, so the avatar-free `probe.py` path still works. Keep the roadmap item and issue open pending a credentialed live barge-in check. | The pinned SDK adapter implements the avatar's `lk.audio_stream`, playback-finished callback, and `lk.clear_buffer` RPC. AgentSession already feeds realtime model audio into its configured sink and clears that sink when speech is interrupted, avoiding a second copy of the protocol. |
| 2026-10-24 | The language picker selects a target profile before connection; that target is passed into the initial session config and retained across learner-level and pace instruction updates. `ACTIVE_PAIR` remains the default rather than mutable global state (#29). | This keeps profiles as config while preventing a later instructions-only update from silently resetting a Korean, French, or Japanese session to Mandarin. The picker is locked during an active connection so its visible value cannot diverge from the live session. |
| 2026-10-23 | Mandarin is the first target language, paired with English. | The team chose it. Tone feedback makes a strong showcase, and Han vs. Latin text makes code-switches visible. |
| 2026-10-23 | Realtime avatar requires LiveKit Cloud, so the prompt and tools stay portable (`shared/session.json`), and a LiveKit spike starts during Phase 1–2. | Higgs Avatar realtime sessions only join LiveKit Cloud rooms, so the browser-direct WebSocket can't drive the avatar. |
| 2026-10-23 | Transcription uses no fixed language. | A fixed language breaks transcription of code-switched speech. |
| 2026-10-23 | Tool `detail` types live in `src/tools/types.ts`, each with a `type` discriminant; `LanguageCode` is defined there for `src/lang/profiles.ts` to import. Correction `kind`: grammar / vocabulary / other. Practice `level`: beginner / intermediate. | Lets `study.ts` and the UI narrow details safely, and keeps one language-code union. |
| 2026-10-23 | Provisionally use `semantic_vad` with Boson's default parameters; keep #7 open pending a live comparison. | Semantic end-of-turn judgement is designed to preserve natural pauses while learners search for words. Validate it against `server_vad` with English, Mandarin and code-switched speech before considering the decision final. |
| 2026-10-23 | `LanguageCode` is declared once, in `src/lang/profiles.ts`; `src/tools/types.ts` re-exports it, and `ToolResult.detail` is typed as `ToolDetail`. Supersedes the 2026-10-23 entry that put the union in `types.ts`. | The profiles landed with their own copy of the union, and two copies drift. Typing `detail` means a handler can only hand the study panel a shape it renders. |
| 2026-10-23 | Learning tools are described as "call this FIRST, before you say anything", and their `summary` tells the model what to say next. | Probed live with the tutor prompt: "call this in the same turn as you correct" got `note_correction` called in 9 of 37 runs; "call this first" got it called in 24 of 24. |
| 2026-10-23 | Practice `level` is beginner / intermediate / advanced (adds advanced, per #13). A missing or unrecognised level is stored as beginner, and the tool's summary says the level aloud. Its `language` argument has no enum. | #13 asked for three levels. Defaulting rather than rejecting follows "schema enums are hints", and speaking the level means a wrong default is heard and corrected. With an en/zh enum, a live request for Korean came back as `en` and the tutor claimed to switch to Korean; as free text, the handler refuses it and the tutor says Korean isn't available yet. |
| 2026-10-24 | Provisionally keep code-switching variant (a), "follow the switch and reply in the language they just used"; keep #6 open. | Probed live, 3 runs per variant of the same three spoken turns (English-first mixed, pure Mandarin, English request plus a sentence with a measure-word error). (a) replied in English to the pure-Mandarin turn in 2 of 3 runs. (b) "mostly target language" stayed in Mandarin there 3 of 3, but dropped English from the mixed correction turn 3 of 3. (c) "learner chooses" asked which language to use in 2 of 3 runs, which #6 rules out. `note_correction` fired on the error turn in only 1 of 9 runs, although the transcript showed the error in at least 7, so no variant meets #6 yet. |
| 2026-10-24 | Code-switching uses an explicit mirror, "when they speak Mandarin, answer in Mandarin; when they speak English, answer in English", with corrections explained in English. Pinyin is asked for only in tool arguments. Supersedes the provisional 2026-10-24 entry; closes #6. | Earlier runs were skewed by a probe bug: when semantic VAD split a turn, the probe moved on before the reply to the rest of it, so the "1 of 9" `note_correction` figure was largely an artifact (fixed in `tools/probe.ts`). With the fix, 3 to 4 runs per variant of the same three spoken turns: (a) answered the pure-Mandarin turn in English 3 of 3; a "Mandarin by default" hybrid called `note_correction` 0 of 3 and spoke pinyin; the explicit mirror with the profile's unscoped "write … with pinyin" note removed answered Mandarin in characters 4 of 4, but went all-Mandarin on the correction turn; adding "explain corrections in English" and dropping "after answering" (which contradicted the tool's "call this FIRST") kept English there 3 of 4 and fired the tool 2 of 4 spoken, 4 of 4 typed. The spoken misses trace to input: TTS-synthesised Mandarin inside English is often mis-transcribed (我有三个狗 → "where your fingers go"), and VAD splits "Can you check this sentence?" from the sentence (#7). |
| 2026-10-24 | Keep `set_practice_language.level` required and restrict the tool description to explicit language or level changes. | Fixes #56 without changing the shared tool-result contract. A mention of the current language or a pronunciation question must not invent `beginner`; genuine requests such as intermediate Mandarin or an unsupported language still follow #13's existing handler behavior. |
| 2026-10-24 | Turn detection is `server_vad` with `silence_duration_ms: 1500`. Supersedes the provisional 2026-10-23 `semantic_vad` entry; closes #7. | Probed live (`--turn-detection` and `[pause N]` in `tools/probe.ts`) with TTS turns paused mid-sentence: English, Mandarin and code-switched turns with 1.4 to 1.85 s of real silence, and one with 2.4 to 2.6 s. A turn counts as whole when it was committed once with no reply mid-sentence. `semantic_vad` at its default (100 ms) and `server_vad` at 500 and 1000 ms: 0 of 8 whole. At 1500 ms `semantic_vad` kept 4 of 8 whole and `server_vad` 10 of 19, so the semantic judgement added nothing: at its default it committed "I went to the…" every time, and any `eagerness` other than `"auto"` is rejected. `server_vad` held every pause shorter than its window and split every longer one. 1500 ms (10 of 15 short-pause turns whole, reply about 1.3 s after speech ends) was chosen over 2000 ms (6 of 6, reply about 1.8 s) to keep the conversation responsive. Pauses over 1.5 s still split a turn. |
| 2026-10-24 | Don't run `scripts/smoke.sh` for issues or PRs; it stays in `scripts/` for when someone asks for a run. A change is verified with `npm test && npm run typecheck && npm run build`, plus one `npm run probe` run when it touches a tool, the prompt, session config or the protocol. | A smoke run makes four live probe sessions and takes minutes, which cost more time per ticket than it saved. |
| 2026-10-24 | Persist a versioned, runtime-validated `StudyState` snapshot in `localStorage`, then rehydrate it as restored tool items that are hidden from the conversation view. | Saved learning data survives reloads without creating a parallel UI store: the study panel and practice badge remain derived from transcript state, and blocked or corrupt storage safely behaves as empty. |
| 2026-10-24 | An issue's PR needs only `npm test && npm run build`, plus unit tests for new logic. Live runs (`npm run probe`, `scripts/smoke.sh`) happen only when the issue asks, and a phase's **Verification** steps are for its exit. Agents commit, push and open PRs without asking; `.claude/settings.json` allows those commands, while pushes to `main` and force-pushes still prompt. Supersedes the earlier 2026-10-24 entry on smoke runs. | Tests and confirmation prompts were costing more time per ticket than they saved. The build already runs `tsc -b`, so a separate typecheck repeated it. |
| 2026-10-24 | Use the `eleanor` preset for Realtime output, provisionally pending a live Mandarin listening check. | Boson's voice library describes Eleanor as calm, articulate and designed for educational explanations, which fits a language tutor; named TTS presets are supported by `audio.output.voice`. |
| 2026-10-24 | The practice level `advanced` uses the intermediate learner-level profile (`learnerLevelFor` in `src/lang/profiles.ts`); `LearnerLevel` stays beginner / intermediate. A level change from `set_practice_language` sends a `session.update` carrying only `instructions`, before the tool output, and a connect starts at the stored level (#77). | Intermediate already asks for mostly the target language, and a third level profile would push the prompt past its length tripwire (#80). Probed 2026-10-24: Higgs acknowledges an instructions-only update with `session.updated` and keeps the VAD, tools and voice from the first update, and the replies after "my level is intermediate now" were all Mandarin. |
| 2026-10-24 | Slow speech goes through a `set_speaking_pace {pace, scope}` tool, which returns no `detail`. A one-off repeat ("say that again slowly") is re-spoken by the client through `/api/tts` with `<\|prosody:speed_slow\|>` and a pause tag between words, and no `response.create` follows. A lasting "speak more slowly" re-sends the session instructions with a slow-pace sentence. `/api/tts` uses the tutor voice (`OUTPUT_VOICE`). The prompt loses its slow-repeat rule and "matching the learner's energy" (#76). | Probed 2026-10-24: the prompt rule left a repeat at the same pace (~170–190 ms per syllable). Slow instructions sent by `session.update` ranged from 150 to 390 ms per syllable depending on whether the model added commas, `response.instructions` lost the conversation, and a TTS speed tag alone added under 20%. Speed plus pause tags made TTS about 3× longer on every run. So the lasting slow mode is best-effort, and only the repeat is reliably slower. |
| 2026-10-24 | Serbian (`sr`) joins Phase 3 as a target language, written in Latin script (`Latn`) with no romanization, like French (#86). | Requested for Phase 3. One probe run: Higgs transcribed spoken Serbian accurately but in Latin script, even though the synthesised input was Cyrillic, so teaching in Latin keeps the tutor's text consistent with the learner's own transcript. Boson lists Serbian in Higgs TTS 3's top tier (WER/CER under 5). |
| 2026-10-24 | The slow repeat is said syllable by syllable: `slowSpeechInput` sends `<\|prosody:speed_slow\|>` with a full stop after every Han character and pinyin word, and leaves English whole. This replaces the pause tags between words from #76. `set_speaking_pace` also covers "say it syllable by syllable". | Probed 2026-10-24: with pause tags, 我今天想去图书馆学习 came back as five even 0.9 s chunks that transcribed as an unrelated repeated phrase, which suggests TTS babble. A stop per syllable ran 3–5× longer than plain, came out as about one speech burst per syllable, and in one run transcribed back exactly. Transcribing isolated syllables is unreliable, so a listening test is still owed. |
| 2026-10-24 | `shared/session.json` holds the `session` object of `buildSessionConfig()` at the default pair, level and pace, written by `npm run export-config` and committed. Re-run it after changing the prompt, voice, VAD, transcription or tools; `test/exportConfig.test.ts` fails while it is stale (#30). | The LiveKit agent is Python and can't import the TypeScript, so contract 4 needs a checked-in copy, and a test is what keeps the copy from drifting. Level and pace changes stay runtime `session.update`s for now. |
| 2026-10-24 | The LiveKit spike runs on LiveKit Cloud: `livekit/agent.py` loads `shared/session.json`, and tool calls get a stand-in result until #32 forwards them to the browser. Closes #31. | Checked live: `probe.py` got a greeting and a reply to "What does 加油 mean?", and "Can you check my sentence? 我有三本狗。" called `note_correction` with the corrected sentence and pinyin, which the tutor then said. A spoken conversation in the Agents Playground was heard and answered. Raw tool schemas reach the model unchanged, so #32 only has to replace the stand-in handler. |
| 2026-10-24 | LiveKit tool calls go to the browser over RPC method `polyglot.run_tool`: the agent sends `{call_id, name, arguments}` to `room_io.linked_participant`, and the browser answers with the `ToolResult` as JSON (`src/livekit/toolRpc.ts`, `livekit/tools.py`). A participant without the method (Agents Playground, `probe.py`) gets the stand-in; a timeout or bad answer gets `{summary, error: "tool_unavailable"}`. The browser must call `registerToolRpc` as soon as the room connects (#35). Level and pace side effects that `RealtimeClient` applies after a tool still only happen in direct-WebSocket mode. Closes #32. | The linked participant rather than the first remote one because the avatar joins the room in Phase 4. The browser emits the call as `response.function_call_arguments.done`, which the reducer already turns into a tool item, then `client.tool_result`, so the study panel needs no change. Checked live with `probe.py --tools`, which answers through `src/livekit/toolRpc.ts`: `note_correction` was forwarded and the tutor said the corrected sentence from the browser's summary; without `--tools` the stand-in answered. |
| 2026-10-24 | Avatar sessions are created by the token server (`server/avatar.ts`): `POST /api/livekit/token` makes a fresh `polyglot-<id>` room and a 10-minute learner token (microphone, subscribe, data for #32's RPC); once the learner is in the room, `POST /api/avatar/sessions {room}` mints the avatar's token and creates the session with `publisher_identity: "polyglot-tutor"`; `GET`/`DELETE /api/avatar/sessions/:id` read and release it, only for sessions this server created. The agent accepts every job as `polyglot-tutor` (`livekit/agent.py`), so no agent token is minted: LiveKit issues it on dispatch. `capacity_exhausted`, `service_unavailable` and `rate_limit_exceeded` are retried after `Retry-After` (or 1 s, 2 s), at most 3 tries and 10 s; a longer wait goes back to the browser with `Retry-After`, and #35 falls back to direct-WebSocket mode. If realtime avatars stay blocked, the contingency is pre-rendered clips from `POST /v1/videos/stream`. Closes #33. | Fixed identity because the avatar only plays audio from `publisher_identity`, and LiveKit otherwise names the agent `agent-<job id>`. Created after the learner joins because Boson ends a session once no other participant is left. Checked live: the avatar joined and published video, `GET` showed `active`, and after leaving, `DELETE` returned `terminated`. Rate limits hit the `GET` and `DELETE` right after a create with no `Retry-After`, hence the backoff. The avatar also stayed `active` after the learner left, because the agent stays in the room after its session closes, so the browser's `DELETE` is what frees the slot (worth an agent-side fix with #34). |
| 2026-10-24 | Avatar mode (`src/livekit/AvatarSession.ts`) joins the room with `/api/livekit/token`, registers `polyglot.run_tool` and the `lk.transcription` text-stream handler **before** connecting, publishes the mic, then creates the avatar; leaving (or `pagehide`, with `keepalive`) `DELETE`s the session. Transcripts come from LiveKit Agents' `lk.transcription` streams and are turned into the Realtime events the reducer already handles (`src/livekit/transcription.ts`): learner segments become `speech_started` then `input_audio_transcription.completed`, tutor segments become `output_audio_transcript.delta`/`.done`, keyed `lk-<segment id>`. Any failure to start (an error code from the token server, or a room that won't connect) leaves the room and switches the toggle to voice-only (direct WebSocket) for that visit; only an explicit choice is remembered. The picker is disabled in avatar mode, because the agent starts from `shared/session.json`'s default pair. (#35) | No Realtime events reach the browser in LiveKit mode, so mapping the streams onto existing events keeps one transcript source of truth and leaves the transcript, study panel and recap unchanged. The session reports `open` only once the avatar exists, so a failed attempt doesn't show the recap. Every remote audio track is played, which works both before and after #34 moves the agent's speech to the avatar. |
| 2026-10-24 | Avatar mode tutors in the picked language and level. `npm run export-config` also writes `shared/prompts.json` (`buildTutorPrompts()`, keyed `[language][level]`); the browser sends `{language, level}` to `POST /api/livekit/token`, which validates them (unknown → default pair) and puts them in the learner token's metadata; `livekit/agent.py` waits for the learner and picks the prompt with `instructions_for`, keeping `session.json`'s prompt for participants without metadata (Playground, `probe.py`). The picker is enabled in avatar mode. The browser also waits up to 10 s for `polyglot-tutor` before creating the avatar and otherwise fails with `agent_not_running`, falling back to voice only; `npm run dev:avatar` starts the agent with the server and Vite. Supersedes the "picker is disabled in avatar mode" part of the #35 entry. | Avatar mode only ever ran Mandarin, because the agent read the single default prompt. A browser session without the agent left a silent avatar and an unheard mic with no error (a live room had the learner and avatar but no agent). Checked live with a scratch client acting as the browser: with Korean metadata the agent logged the choice, greeted with "안녕하세요", transcribed spoken "저는 학생이에요" and the avatar's audio track carried the reply. |
| 2026-10-24 | The on-screen tutor's delivery is one reworded prompt sentence, shared by both modes: "Keep every reply to one or two short sentences, said warmly and expressively, as if face to face." `shared/session.json` re-exported. (#35) | Short turns were already in the prompt; only expressiveness was missing, and rewording an existing sentence rather than adding a rule keeps the prompt as short as before (extra rules stopped tool calls). No avatar-only variant, because the agent would need a second exported prompt. Probed: "Can you check my sentence? 我有三本狗。" still called `note_correction` and the reply stayed two sentences. |
| 2026-10-24 | Avatar mode applies `set_speaking_pace` in the agent. `npm run export-config` also writes `shared/pace.json` (`{slow_note: SLOW_PACE_NOTE}`); `livekit/agent.py` builds a slow prompt as `prompt + " " + slow_note`, which `test/exportConfig.test.ts` checks against `buildTutorPrompt(..., "slow")`. A lasting change re-instructs the session; a one-off slow repeat re-instructs it slowly and reverts when the learner next starts speaking, since the avatar has to say the repeat itself and there is no TTS replay. A language or level switch keeps the pace. Supersedes the "pace side effects only happen in direct-WebSocket mode" part of the #32 entry. | In avatar mode "please say that slower" repeated the line at the same speed, which learners heard as the tutor looping. Checked live with a scratch LiveKit client: the model called `set_speaking_pace` and the agent logged the slow pace. Prompt-only slowing is best effort (#76). |
