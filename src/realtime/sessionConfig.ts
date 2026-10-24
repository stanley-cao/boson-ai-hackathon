import type { ClientEvent } from "./events";
import { TOOL_DEFINITIONS } from "../tools/definitions";
import { ACTIVE_PAIR, PROFILES, type LanguageProfile } from "../lang/profiles";

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
 * The learner's native language and the target language both come from
 * `ACTIVE_PAIR`; the target's `promptNotes` carry the teaching specifics.
 *
 * Code-switching: the tutor replies in whichever language the learner just
 * used, rather than asking which one they want. That matches how the learner
 * talks and avoids a question that would break the flow. The probe has not
 * yet compared this with the target-language-first variant; see the ROADMAP
 * decision log once that run is recorded.
 */
export function buildTutorPrompt(
  target: LanguageProfile = PROFILES[ACTIVE_PAIR.target],
  native: LanguageProfile = PROFILES[ACTIVE_PAIR.native],
): string {
  return [
    // Role and capabilities.
    `You are a friendly language tutor. The learner speaks ${native.name} and is learning ${target.name}.`,
    // Code-switching.
    "They switch between the two mid-sentence. Follow the switch and reply in the language they just used.",
    "Never ask which language they want.",
    // Teaching.
    "Give at most one correction per turn, after answering what they said.",
    target.promptNotes,
    target.romanization
      ? `In tool arguments, write ${target.name} with ${target.romanization} and tone marks.`
      : "",
    // Speaking style.
    "Keep every reply to one or two short sentences, matching the learner's energy.",
    "You are speaking aloud, not writing — no lists, no markdown, no emoji, no URLs.",
    // Turn-taking.
    "A short follow-up question is fine; do not interrogate, and do not add",
    "detail the learner did not ask for.",
    // Tool use: nothing here on purpose. When to call each tool lives in its
    // description (src/tools/definitions.ts), which keeps this prompt short.
  ]
    .filter(Boolean)
    .join(" ");
}

export const SYSTEM_PROMPT = buildTutorPrompt();

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

export function buildSessionConfig(): ClientEvent {
  return {
    type: "session.update",
    session: {
      model: "higgs-realtime",
      instructions: SYSTEM_PROMPT,
      // Exactly ["audio"] or exactly ["text"] — this is not a list you can mix.
      // Asking for audio still gives you a text transcript of what was spoken,
      // via the response.output_audio_transcript.* events.
      output_modalities: ["audio"],
      audio: {
        input: {
          format: { type: "audio/pcm", rate: AUDIO_RATE },
          // Language learners pause while searching for words. Semantic VAD
          // combines speech detection with an end-of-turn judgement, making it
          // less likely to cut those pauses into separate turns than a fixed
          // silence window. Keep the documented defaults until issue #7's live
          // English, Mandarin and code-switching comparison is complete.
          turn_detection: { type: "semantic_vad" },
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
          // POLYGLOT: no `language`. Pinning one (the tutorial used "en") would
          // force every turn through a single-language transcriber and mangle
          // code-switched speech. Leaving it out lets the server detect it.
          transcription: { model: "higgs-stt-3.1" },
        },
        output: {
          format: { type: "audio/pcm", rate: AUDIO_RATE },
          voice: "default",
        },
      },
      // PART 4: the tools the model may call. Plain JSON Schema — there is no
      // "executor" field, because running them is entirely the client's job.
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
    },
  };
}
