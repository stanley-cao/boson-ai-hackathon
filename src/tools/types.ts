// The structured `detail` payloads behind each tool's spoken `summary`.
//
// This file is a shared contract (see docs/ROADMAP.md, "Shared contracts" #2):
// Track B's handlers return these shapes and Track C renders only from them.
// Changing a field here needs a decision-log entry.

/**
 * BCP-47 base codes for the languages we teach.
 *
 * Kept identical to `LanguageProfile.code` so `src/lang/profiles.ts` can import
 * it rather than declare a second union that drifts. Handlers normalise model
 * arguments ("Mandarin", "zh-CN", "ZH") down to one of these before building a
 * detail, so the UI never sees a raw model string.
 */
export type LanguageCode = "en" | "zh" | "ko" | "fr" | "ja";

/**
 * A mistake the learner made and its fix. Produced by `note_correction`.
 *
 * `type` is a discriminant on every detail so `src/state/study.ts` and the UI
 * can narrow a `ToolDetail` without inspecting which fields happen to exist.
 */
export interface Correction {
  type: "correction";
  language: LanguageCode;
  /** What the learner said, as the model heard it. */
  said: string;
  correct: string;
  explanation: string;
  kind: "grammar" | "vocabulary" | "other";
  /** Pinyin (with tone marks) etc. for `correct`, when the script isn't Latin. */
  romanization?: string;
}

/** A word or phrase the learner wants to keep. Produced by `save_phrase`. */
export interface Phrase {
  type: "phrase";
  language: LanguageCode;
  phrase: string;
  /** Meaning in the learner's native language. */
  meaning: string;
  romanization?: string;
  note?: string;
}

/**
 * Feedback on how something was pronounced. Produced by `pronunciation_feedback`.
 *
 * `issue` uses Mandarin syllable terms (initial / final / tone) because tone
 * feedback is the Phase 1 showcase; other languages fall back to "other".
 */
export interface PronunciationNote {
  type: "pronunciation";
  language: LanguageCode;
  /** The word or syllable being practised. */
  target: string;
  romanization?: string;
  issue: "tone" | "initial" | "final" | "other";
  tip: string;
}

/** The language and level being practised. Produced by `set_practice_language`. */
export interface PracticeLanguage {
  type: "practice_language";
  language: LanguageCode;
  level: "beginner" | "intermediate";
}

export type ToolDetail = Correction | Phrase | PronunciationNote | PracticeLanguage;

/** Which tool produces which detail type, keyed by the tool's schema name. */
export interface ToolDetailByName {
  note_correction: Correction;
  save_phrase: Phrase;
  pronunciation_feedback: PronunciationNote;
  set_practice_language: PracticeLanguage;
}
