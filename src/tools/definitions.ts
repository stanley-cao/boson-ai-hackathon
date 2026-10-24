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
      "correction to their study panel and then tells you what to say. After it " +
      "returns, say the `correct` text clearly exactly once.",
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
] as const;
