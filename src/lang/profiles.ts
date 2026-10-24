/**
 * Language profiles: everything language-specific lives here as data, so the
 * system prompt (and later the UI and smoke tests) are built from a profile
 * rather than hard-coding a language. Adding ko/fr/ja is a new entry, not new
 * code. This is shared contract #1 in docs/ROADMAP.md — change its shape only
 * with a decision-log entry.
 */

// BCP-47 base codes. Tool handlers normalise whatever the model sends
// ("Mandarin", "zh-CN", "ZH") down to one of these.
export type LanguageCode = "en" | "zh" | "ko" | "fr" | "ja";

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
    "Write Simplified characters with pinyin using tone marks (nǐ hǎo, not ni3 hao3). " +
    "Listen closely for tone errors and missing or wrong measure words.",
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
