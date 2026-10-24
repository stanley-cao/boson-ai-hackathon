import type { ClientEvent } from "./events";
import { TOOL_DEFINITIONS } from "../tools/definitions";
import type { PaceRequest, SpeakingPace } from "../tools/handlers";
import {
  ACTIVE_LEVEL,
  ACTIVE_PAIR,
  LEARNER_LEVELS,
  PROFILES,
  TARGET_LANGUAGE_CODES,
  learnerLevelFor,
  type LanguageProfile,
  type TargetLanguageCode,
  type LearnerLevel,
  type LearnerLevelProfile,
} from "../lang/profiles";

/**
 * The first thing we send after the socket opens.
 *
 * `session.update` configures the whole session: who the model is, what it
 * sounds like, and what audio format both directions use. The first one you
 * send starts the session and is acknowledged with `session.created`; later
 * ones are acknowledged with `session.updated`.
 *
 * Every field here is set deliberately. Fields this part does not need —
 * turn detection (Part 2), tools (Part 4) — are simply absent, and take the
 * server's documented defaults.
 */

// The prompt follows the structure in docs/part-5.md — role and capabilities,
// speaking style, turn-taking, tool-use policy, spoken-output constraints —
// and it is deliberately SHORT. While building this tutorial, six extra
// sentences of behavioural rules appended here stopped the model calling
// tools at all. Guidance about a specific tool belongs in that tool's
// description, not here.
/**
 * Built from the language profiles, so changing the pair is a data change.
 * The learner's native language comes from `ACTIVE_PAIR`; the target defaults
 * there too, but the picker may provide another profile. Its `promptNotes`
 * carry the teaching specifics.
 *
 * Code-switching: an explicit "target → target, native → native" mirror,
 * with corrections explained in the native language. Probed 2026-10-24 (see
 * the ROADMAP decision log): plain "reply in the language they just used"
 * answered Mandarin in English, "mostly the target language" dropped English
 * from corrections and stopped tool calls, and "learner chooses" asked them
 * to pick. Pinyin is confined to tool arguments; an unscoped "write with
 * pinyin" made the tutor speak pinyin instead of characters.
 */
export function buildTutorPrompt(
  target: LanguageProfile = PROFILES[ACTIVE_PAIR.target],
  native: LanguageProfile = PROFILES[ACTIVE_PAIR.native],
  level: LearnerLevelProfile = LEARNER_LEVELS[ACTIVE_LEVEL],
  pace: SpeakingPace = "normal",
): string {
  return [
    // Role and capabilities.
    `You are a friendly language tutor. The learner speaks ${native.name} and is learning ${target.name}.`,
    // Level controls both audible pace and how much native-language support to
    // provide. Keeping this in data makes the two modes directly testable.
    level.promptNotes,
    // Code-switching.
    "They switch mid-sentence; never ask which language they want.",
    `When they speak ${target.name}, answer in ${target.name}; when they speak ${native.name}, answer in ${native.name}.`,
    // Teaching.
    `Give at most one correction per turn, and explain it in ${native.name}.`,
    // "Say it clearly exactly once" after a correction (#22) lives in each
    // tool's description and result summary, not here (#80).
    target.promptNotes,
    target.romanization
      ? `In tool arguments, use ${target.romanization} romanization${target.romanization === "pinyin" ? " with tone marks" : ""}.`
      : "",
    // Speaking style. Slow requests go through set_speaking_pace, not a rule
    // here: a rule to repeat slowly didn't change the pace (#76), and
    // "matching the learner's energy" worked against slowing down. Short and
    // expressive suits the on-screen avatar (#35); one sentence reworded
    // rather than a rule added, since extra rules stopped tool calls.
    "Keep every reply to one or two short sentences, said warmly and expressively, as if face to face.",
    "You are speaking aloud, not writing — no lists, no markdown, no emoji, no URLs.",
    // Turn-taking.
    "A short follow-up is fine; do not interrogate or add unasked detail.",
    // Tool use: nothing here on purpose. When to call each tool lives in its
    // description (src/tools/definitions.ts), which keeps this prompt short.
    // Last, where it was probed: it doubled ms per syllable (#76).
    pace === "slow" ? SLOW_PACE_NOTE : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export const SLOW_PACE_NOTE =
  "Speak very slowly now, at about half your normal speed, with a short pause between words.";

export const SYSTEM_PROMPT = buildTutorPrompt();

/**
 * Every target language's prompt at every level, at normal pace, keyed
 * `[language][level]`. Exported to shared/prompts.json for the LiveKit agent,
 * which picks the learner's choice from their room token (avatar mode).
 */
export function buildTutorPrompts(): Record<TargetLanguageCode, Record<LearnerLevel, string>> {
  const prompts = {} as Record<TargetLanguageCode, Record<LearnerLevel, string>>;
  for (const code of TARGET_LANGUAGE_CODES) {
    prompts[code] = {
      beginner: buildTutorPrompt(PROFILES[code], PROFILES[ACTIVE_PAIR.native], LEARNER_LEVELS.beginner),
      intermediate: buildTutorPrompt(PROFILES[code], PROFILES[ACTIVE_PAIR.native], LEARNER_LEVELS.intermediate),
    };
  }
  return prompts;
}

/**
 * PCM16 at 24 kHz, both directions.
 *
 * `audio/pcm` means raw 16-bit signed samples, little-endian, mono — no
 * container, no compression, just numbers. 24000 is the documented default rate
 * and it is what we pin here, for a reason that matters later: our playback
 * AudioContext also runs at 24000, so one sample out of the API is exactly one
 * sample into the speakers. In Part 2 that one-to-one mapping is what lets us
 * tell the server precisely how much audio the user actually heard.
 *
 * The API also accepts 8000, 16000 and 48000 for PCM, plus `audio/pcmu`
 * (G.711 µ-law, telephony) and `audio/opus` (compressed). PCM is the right
 * choice while learning: no decoder, nothing to go wrong.
 */
export const AUDIO_RATE = 24000;
export const INPUT_TRANSCRIPTION_MODEL = "higgs-stt-3.1";
// Boson's preset library describes Eleanor as calm, articulate and suited to
// educational explanations. Keep this named so the probe and tests can report
// the exact voice whose Mandarin delivery needs live acceptance testing.
export const OUTPUT_VOICE = "eleanor";

export function buildSessionConfig(
  level: LearnerLevelProfile = LEARNER_LEVELS[ACTIVE_LEVEL],
  target: LanguageProfile = PROFILES[ACTIVE_PAIR.target],
): ClientEvent {
  return {
    type: "session.update",
    session: {
      model: "higgs-realtime",
      instructions: buildTutorPrompt(
        target,
        PROFILES[ACTIVE_PAIR.native],
        level,
      ),
      // Exactly ["audio"] or exactly ["text"] — this is not a list you can mix.
      // Asking for audio still gives you a text transcript of what was spoken,
      // via the response.output_audio_transcript.* events.
      output_modalities: ["audio"],
      audio: {
        input: {
          format: { type: "audio/pcm", rate: AUDIO_RATE },
          // Language learners pause while searching for words, so the turn
          // only ends after 1.5 s of silence (the default is 500 ms). Probed
          // 2026-10-24 (#7, ROADMAP decision log): semantic_vad committed
          // "I went to the…" at its default window, and at equal windows it
          // held no more pauses than server_vad; its only accepted eagerness
          // is "auto". server_vad holds any pause shorter than this window
          // and splits longer ones; the cost is a ~1.3 s wait after every turn.
          turn_detection: { type: "server_vad", silence_duration_ms: 1500 },
          // PART 3: transcribe the user's speech.
          //
          // Off by default — the ack shows `model: ""` if you omit this — and
          // it is what lets you show the user's own words on screen. The model
          // understands your speech either way; this is purely so *you* can
          // read it.
          //
          // The model name is validated at session.update time: a name the
          // endpoint does not serve fails the update with an error naming it.
          // As of this writing, "higgs-stt-3.1" is the one to use.
          //
          // `null` explicitly requests automatic language detection. The
          // direct client sends this same setting again as each utterance
          // starts: Boson otherwise lets transcription follow the language of
          // the preceding conversation, which can misread a later switch.
          transcription: { model: INPUT_TRANSCRIPTION_MODEL, language: null },
        },
        output: {
          format: { type: "audio/pcm", rate: AUDIO_RATE },
          voice: OUTPUT_VOICE,
        },
      },
      // PART 4: the tools the model may call. Plain JSON Schema — there is no
      // "executor" field, because running them is entirely the client's job.
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
    },
  };
}

/**
 * Reset STT to auto-detection for the utterance that is just beginning.
 *
 * This changes captions only. The target-language profile and tutor prompt
 * stay untouched, so switching spoken language does not silently switch the
 * learner's selected course.
 */
export function buildTranscriptionDetectionReset(): ClientEvent {
  return {
    type: "session.update",
    session: {
      audio: {
        input: {
          transcription: { model: INPUT_TRANSCRIPTION_MODEL, language: null },
        },
      },
    },
  };
}

/**
 * Re-instructs a live session for a learner level and speaking pace.
 *
 * Only `instructions` changes, so the audio, turn-detection and tool settings
 * from the first update stay as they were; acknowledged with
 * `session.updated`. Both level (#77) and pace (#76) live in the prompt, so
 * either change rebuilds it from both. Probed 2026-10-24 (#76): a slow pace
 * sent this way slowed some replies; the same sentence as
 * `response.instructions` lost the conversation ("你好. Hello.").
 */
export function buildInstructionsUpdate(
  level: LearnerLevel,
  pace: SpeakingPace,
  target: TargetLanguageCode = ACTIVE_PAIR.target,
): ClientEvent {
  return {
    type: "session.update",
    session: {
      instructions: buildTutorPrompt(
        PROFILES[target],
        PROFILES[ACTIVE_PAIR.native],
        LEARNER_LEVELS[level],
        pace,
      ),
    },
  };
}

/**
 * The level a tool result moves the session to, or null when it doesn't.
 *
 * Only `set_practice_language` changes level, and only when its detail maps
 * to a different prompt profile: "intermediate" → "advanced" keeps the same
 * instructions, so it isn't worth a session.update. Results arrive as
 * `unknown` from the registry, so the shape is checked rather than trusted.
 */
export function levelChangeFromTool(
  name: string,
  result: unknown,
  current: LearnerLevel,
): LearnerLevel | null {
  if (name !== "set_practice_language") return null;
  const detail = (result as { detail?: { type?: unknown; level?: unknown } } | null)?.detail;
  if (detail?.type !== "practice_language" || typeof detail.level !== "string") return null;
  const next = learnerLevelFor(detail.level);
  return next === current ? null : next;
}

/** What the client does about a `set_speaking_pace` call. */
export interface PacePlan {
  /** The pace to re-instruct the session with before the reply, if any. */
  send: SpeakingPace | null;
  /** Restore `sessionPace` once the reply is done (a one-off slow repeat). */
  revertAfterReply: boolean;
  /** The lasting pace afterwards. */
  sessionPace: SpeakingPace;
}

/**
 * Plan a pace change against the session's lasting pace. A one-off slow
 * repeat is sent and then reverted; a session change is kept. Nothing is sent
 * when the pace is already right.
 */
export function planPaceChange(request: PaceRequest, sessionPace: SpeakingPace): PacePlan {
  if (request.scope === "session") {
    return {
      send: request.pace === sessionPace ? null : request.pace,
      revertAfterReply: false,
      sessionPace: request.pace,
    };
  }
  const already = request.pace === sessionPace;
  return { send: already ? null : request.pace, revertAfterReply: !already, sessionPace };
}
