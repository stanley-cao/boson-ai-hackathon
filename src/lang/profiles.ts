/**
 * Language profiles: everything language-specific lives here as data, so the
 * system prompt (and later the UI and smoke tests) are built from a profile
 * rather than hard-coding a language. Adding ko/fr/ja is a new entry, not new
 * code. This is shared contract #1 in docs/ROADMAP.md — change its shape only
 * with a decision-log entry.
 */

// BCP-47 base codes. Tool handlers normalise whatever the model sends
// ("Mandarin", "zh-CN", "ZH") down to one of these.
export type LanguageCode = "en" | "zh" | "ko" | "fr" | "ja" | "sr";

export interface LanguageProfile {
  code: LanguageCode;
  name: string;
  script: "Latn" | "Hans" | "Hang" | "Jpan";
  romanization?: "pinyin" | "revised" | "hepburn";
  // Goes into the system prompt verbatim, so it must stay to a sentence or
  // two: upstream found that extra prompt rules stopped the model calling
  // tools at all.
  promptNotes: string;
  sampleOpeners: string[];
}

export type LearnerLevel = "beginner" | "intermediate";

export interface LearnerLevelProfile {
  code: LearnerLevel;
  /** Short because this is inserted into every realtime system prompt. */
  promptNotes: string;
}

const en: LanguageProfile = {
  code: "en",
  name: "English",
  script: "Latn",
  promptNotes: "The learner's native language; use it for brief explanations and scaffolding.",
  sampleOpeners: [
    "Hi! What would you like to practise today?",
    "How was your day? Feel free to switch languages whenever you like.",
  ],
};

// Simplified, not Traditional: it is what mainland learners and most courses
// use, and it fixes which characters the tutor writes in tool calls.
const zh: LanguageProfile = {
  code: "zh",
  name: "Mandarin Chinese",
  script: "Hans",
  romanization: "pinyin",
  promptNotes:
    "Speak in Simplified characters. Listen closely for tone errors and missing or wrong measure words.",
  sampleOpeners: ["你好！今天想聊什么？", "你今天过得怎么样？", "我们用中文聊聊天吧！"],
};

// `satisfies` rather than a `Record<LanguageCode, …>` annotation: only two
// languages exist yet, and this keeps the keys literal so `PROFILES.zh` is
// known to be defined.
export const PROFILES = { en, zh } satisfies Partial<Record<LanguageCode, LanguageProfile>>;

export const ACTIVE_PAIR = { native: "en", target: "zh" } as const satisfies {
  native: keyof typeof PROFILES;
  target: keyof typeof PROFILES;
};

export const LEARNER_LEVELS = {
  beginner: {
    code: "beginner",
    promptNotes:
      "Learner level: beginner. Speak slowly, use short simple target-language phrases, " +
      "and add brief English scaffolding after them.",
  },
  intermediate: {
    code: "intermediate",
    promptNotes:
      "Learner level: intermediate. Speak at a natural but clear pace, use mostly the " +
      "target language, and use English only for brief clarification.",
  },
} as const satisfies Record<LearnerLevel, LearnerLevelProfile>;

/** Default for a new session; callers may select another profile explicitly. */
export const ACTIVE_LEVEL: LearnerLevel = "beginner";

/**
 * The prompt profile for a level as stored or as `set_practice_language`
 * reports it. "advanced" shares the intermediate profile rather than getting
 * its own: intermediate already asks for mostly the target language, and the
 * prompt is near its length tripwire (#80). Anything else, including no stored
 * level, falls back to the default.
 */
export function learnerLevelFor(level: string | null | undefined): LearnerLevel {
  if (level === "intermediate" || level === "advanced") return "intermediate";
  return ACTIVE_LEVEL;
}
