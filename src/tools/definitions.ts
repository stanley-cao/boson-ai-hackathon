import { PROFILES } from "../lang/profiles";

// The tool definitions sent in session.update.
//
// The shape is the same JSON Schema you would use anywhere else:
//
//   { type: "function", name, description, parameters }
//
// There is no "executor" field and nothing to register a callback with. The
// server tells you a tool was called; running it is entirely your business.
// That is the whole of "client-side tool execution" — the client is where the
// code is because the client is where you put it.
//
// Every `language` enum is built from the profiles, so a language is offered
// to the model as soon as it has one. Like any enum it is only a hint: the
// handlers normalise whatever comes back.

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "note_correction",
    // Leads with when to call it, as save_phrase does: later in a
    // conversation, a sentence with a measure-word error was often corrected
    // aloud without a call (#58). "Not when nothing needs changing" is for the
    // no-op corrections it saved when asked about tones.
    description:
      "Call this FIRST, before you say anything else, whenever something the " +
      "learner says has a grammar or word mistake, at any point in the " +
      "conversation, including when they ask you to check a sentence or mix " +
      "languages in one turn. It saves the correction to their study panel and " +
      "then tells you what to say. Not for pronunciation, and not when nothing " +
      "needs changing. After it returns, say the `correct` text clearly exactly once.",
    parameters: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: Object.keys(PROFILES),
          description: "The language the mistake was in.",
        },
        said: {
          type: "string",
          description:
            "What the learner said, as you heard it, in its own script " +
            "(Chinese characters for Mandarin, not pinyin).",
        },
        correct: {
          type: "string",
          description: "The corrected version, in the same script as `said`.",
        },
        explanation: {
          type: "string",
          description: "One short sentence on why, in the learner's native language.",
        },
        kind: {
          type: "string",
          enum: ["grammar", "vocabulary", "other"],
          description: "What sort of mistake it was.",
        },
        romanization: {
          type: "string",
          description:
            "The corrected version romanized, for a language not written in " +
            "Latin letters. For Mandarin, pinyin with tone marks, e.g. " +
            "'wǒ yǒu sān zhī gǒu'.",
        },
      },
      required: ["language", "said", "correct", "explanation", "kind"],
    },
  },
  {
    type: "function",
    name: "set_practice_language",
    description:
      "Switch the language or level only when the learner explicitly asks for " +
      "a different language than the one they are already practising, or " +
      "explicitly states a new level. Do NOT call this merely because they name " +
      "or ask to practise their current language, or ask for pronunciation " +
      "feedback. Never infer a new level. For a real switch, call this FIRST, " +
      "before you say anything else; it updates their badge and then tells you " +
      "what to say.",
    parameters: {
      type: "object",
      properties: {
        language: {
          type: "string",
          // Deliberately no enum, unlike the other tools. Asked for Korean with
          // only en/zh on offer, the model sent "en" and told the learner
          // they'd switched to Korean. Free text lets the handler refuse it.
          description:
            "The language they asked for, as a code or a name, e.g. 'zh' or " +
            "'Korean'. Pass what they asked for even if you can't teach it; " +
            "the result says which languages are available.",
        },
        level: {
          type: "string",
          enum: ["beginner", "intermediate", "advanced"],
          description:
            "Their level in it. If they didn't say, keep the level they had, " +
            "or use beginner.",
        },
      },
      required: ["language", "level"],
    },
  },
  {
    type: "function",
    name: "pronunciation_feedback",
    description:
      "Give the learner feedback on a sound they got wrong. Whenever you hear " +
      "them mispronounce something (for Mandarin, above all a wrong tone, or a " +
      "wrong initial or final), or they ask how to pronounce something, call " +
      "this FIRST, before you say anything else; it shows the note on their " +
      "screen and then tells you what to say. After it returns, say the " +
      "`target` clearly exactly once.",
    parameters: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: Object.keys(PROFILES),
          description: "The language being spoken.",
        },
        target: {
          type: "string",
          description:
            "The word or syllable, in its own script (Chinese characters for " +
            "Mandarin, not pinyin), e.g. '妈'.",
        },
        romanization: {
          type: "string",
          description:
            "How it should sound. For Mandarin, pinyin with tone marks, not tone " +
            "numbers, e.g. 'mā' rather than 'ma1'.",
        },
        issue: {
          type: "string",
          enum: ["tone", "initial", "final", "other"],
          description:
            "What was wrong: the tone, the initial (the consonant it starts " +
            "with), the final (the vowel part after it), or something else.",
        },
        tip: {
          type: "string",
          // No single example tip here: the model copied one verbatim into its
          // tips for other tones in live probes. A list of every contour is a
          // reference to pick from, and the handler checks the tip against the
          // tone marks anyway (#55).
          description:
            "One short, practical tip for making this sound correctly. For a " +
            "Mandarin tone, describe the tone written in `romanization`: first " +
            "(ā) high and level, second (á) rising, third (ǎ) low and dipping, " +
            "fourth (à) sharply falling, neutral short and light.",
        },
      },
      required: ["language", "target", "issue", "tip"],
    },
  },
  {
    type: "function",
    name: "save_phrase",
    // Leads with when to call it. Probed live, "how do you say 谢谢 in English?"
    // after a greeting was answered without a call (0 of 8) until the
    // description opened with the trigger (5 of 5).
    description:
      "Call this FIRST, before you say anything else, whenever the learner " +
      "asks what a word or phrase means or how to say something, even after a " +
      "greeting or in the middle of a sentence. Also call it when you teach " +
      "them a new word or they ask you to remember one. It saves the phrase to " +
      "the phrase list on their screen and then tells you what to say.",
    parameters: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: Object.keys(PROFILES),
          description: "The language the phrase is in.",
        },
        phrase: {
          type: "string",
          description:
            "The word or phrase in its own script (Chinese characters for " +
            "Mandarin, not pinyin), e.g. '加油'.",
        },
        meaning: {
          type: "string",
          description: "What it means, in the learner's native language.",
        },
        romanization: {
          type: "string",
          description:
            "How to say it, for a language not written in Latin letters. For " +
            "Mandarin, pinyin with tone marks, e.g. 'jiā yóu'.",
        },
        note: {
          type: "string",
          description: "Optional: a short usage note, e.g. 'said to cheer someone on'.",
        },
      },
      required: ["language", "phrase", "meaning"],
    },
  },
] as const;
