/**
 * Language profiles: everything language-specific lives here as data, so the
 * system prompt (and later the UI and smoke tests) are built from a profile
 * rather than hard-coding a language. Adding a target is a new entry, not new
 * code. This is shared contract #1 in docs/ROADMAP.md — change its shape only
 * with a decision-log entry.
 */
import { MORE_PROFILES, type MoreLanguageCode } from "./moreProfiles";

// BCP-47 base codes. Tool handlers normalise whatever the model sends
// ("Mandarin", "zh-CN", "ZH") down to one of these.
export type LanguageCode = "en" | "zh" | "ko" | "fr" | "ja" | "sr" | "vi" | MoreLanguageCode;

// ISO 15924 codes for the script the tutor writes each language in.
export type Script =
  | "Latn" | "Hans" | "Hang" | "Jpan" | "Cyrl" | "Arab" | "Hebr" | "Grek"
  | "Armn" | "Geor" | "Deva" | "Beng" | "Gujr" | "Knda" | "Mlym" | "Taml"
  | "Telu" | "Thai";

/**
 * A character of each non-Latin script, and what to call the script when
 * asking the model to write in it. `note_correction` rejects a correction
 * with none of its language's characters, as romanization in the wrong field.
 * Japanese mixes kanji and kana; Assamese shares the Bengali block.
 */
export const SCRIPT_PATTERNS: Partial<Record<Script, { pattern: RegExp; name: string }>> = {
  Hans: { pattern: /\p{Script=Han}/u, name: "Chinese characters" },
  Hang: { pattern: /\p{Script=Hangul}/u, name: "Hangul" },
  Jpan: { pattern: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, name: "Japanese script" },
  Cyrl: { pattern: /\p{Script=Cyrillic}/u, name: "Cyrillic" },
  Arab: { pattern: /\p{Script=Arabic}/u, name: "Arabic script" },
  Hebr: { pattern: /\p{Script=Hebrew}/u, name: "Hebrew letters" },
  Grek: { pattern: /\p{Script=Greek}/u, name: "the Greek alphabet" },
  Armn: { pattern: /\p{Script=Armenian}/u, name: "the Armenian alphabet" },
  Geor: { pattern: /\p{Script=Georgian}/u, name: "the Georgian alphabet" },
  Deva: { pattern: /\p{Script=Devanagari}/u, name: "Devanagari" },
  Beng: { pattern: /\p{Script=Bengali}/u, name: "Bengali script" },
  Gujr: { pattern: /\p{Script=Gujarati}/u, name: "Gujarati script" },
  Knda: { pattern: /\p{Script=Kannada}/u, name: "Kannada script" },
  Mlym: { pattern: /\p{Script=Malayalam}/u, name: "Malayalam script" },
  Taml: { pattern: /\p{Script=Tamil}/u, name: "Tamil script" },
  Telu: { pattern: /\p{Script=Telugu}/u, name: "Telugu script" },
  Thai: { pattern: /\p{Script=Thai}/u, name: "Thai script" },
};

export interface LanguageProfile {
  code: LanguageCode;
  name: string;
  script: Script;
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

const ko: LanguageProfile = {
  code: "ko",
  name: "Korean",
  script: "Hang",
  romanization: "revised",
  promptNotes: "Write Korean in Hangul and use Revised Romanization in tool arguments.",
  sampleOpeners: ["안녕하세요! 오늘은 무엇을 연습하고 싶어요?", "오늘 하루는 어땠어요?"],
};

const fr: LanguageProfile = {
  code: "fr",
  name: "French",
  script: "Latn",
  promptNotes: "Use clear, natural French and briefly point out important gender and agreement errors.",
  sampleOpeners: ["Bonjour ! Qu’est-ce que vous aimeriez pratiquer aujourd’hui ?", "Comment s’est passée votre journée ?"],
};

const ja: LanguageProfile = {
  code: "ja",
  name: "Japanese",
  script: "Jpan",
  romanization: "hepburn",
  promptNotes: "Write Japanese in its natural mix of kanji and kana, with Hepburn romanization in tool arguments.",
  sampleOpeners: ["こんにちは！今日は何を練習したいですか？", "今日はどんな一日でしたか？"],
};

const sr: LanguageProfile = {
  code: "sr",
  name: "Serbian",
  script: "Latn",
  promptNotes:
    "Write Serbian in Latin script. Help with its seven noun cases, verb aspect pairs, and the č/ć and dž/đ distinctions.",
  sampleOpeners: [
    "Zdravo! Šta želiš da vežbaš danas?",
    "Kako ti je prošao dan?",
  ],
};

// Latin script with its diacritics kept: they carry the tones, so dropping
// them would make tone corrections impossible to show in text.
const vi: LanguageProfile = {
  code: "vi",
  name: "Vietnamese",
  script: "Latn",
  promptNotes:
    "Write Vietnamese with full tone marks. Listen closely for its six tones, and help with classifiers and pronouns of address.",
  sampleOpeners: ["Xin chào! Hôm nay bạn muốn luyện tập gì?", "Hôm nay của bạn thế nào?"],
};

export const PROFILES = { en, zh, ko, fr, ja, sr, vi, ...MORE_PROFILES } satisfies Partial<
  Record<LanguageCode, LanguageProfile>
>;

export type ProfileCode = keyof typeof PROFILES;
export type TargetLanguageCode = Exclude<ProfileCode, "en">;
// Sorted by name, so the picker (and prompts.json) reads A to Z across 84
// languages instead of in the order they were added.
export const TARGET_LANGUAGE_CODES: readonly TargetLanguageCode[] = (
  Object.keys(PROFILES) as ProfileCode[]
)
  .filter((code): code is TargetLanguageCode => code !== "en")
  .sort((a, b) => PROFILES[a].name.localeCompare(PROFILES[b].name, "en"));

export const ACTIVE_PAIR = { native: "en", target: "zh" } as const satisfies {
  native: keyof typeof PROFILES;
  target: keyof typeof PROFILES;
};

export const LEARNER_LEVELS = {
  beginner: {
    code: "beginner",
    // Concrete, because "add brief English scaffolding" was ignored: probed
    // beginners asking in English got target-only replies, promises like "I'll
    // show you how to say hello" with nothing after, and their own question
    // said back to them. A word count rather than "short": probes taught
    // six-word phrases like "Watashi no namae wa Sam desu".
    promptNotes:
      "Learner level: beginner. Speak slowly. Each reply says one very short, easy " +
      "target-language phrase of two to four everyday words, then what it means in English. " +
      "When they ask how to say something, say it straight away; when they ask you " +
      "something, answer it instead of repeating it.",
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
