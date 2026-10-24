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
    description:
      "Correct a mistake the learner just made. Whenever what they said has a " +
      "mistake, call this FIRST, before you say anything else; it saves the " +
      "correction to their study panel and then tells you what to say.",
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
      "Switch the language or level the learner is practising. Only when they " +
      "ask to practise a different language or change their level, call this " +
      "FIRST, before you say anything else; it updates the badge on their " +
      "screen and then tells you what to say.",
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
] as const;
