// The structured `detail` payloads behind each tool's spoken `summary`.
//
// This file is a shared contract (see docs/ROADMAP.md, "Shared contracts" #2):
// Track B's handlers return these shapes and Track C renders only from them.
// Changing a field here needs a decision-log entry.

// The language-code union belongs to the profiles (shared contract #1).
// Re-exported rather than redeclared, so the two can't drift, and so code that
// renders details needs only this module. Handlers normalise model arguments
// ("Mandarin", "zh-CN", "ZH") down to one of these before building a detail, so
// the UI never sees a raw model string.
import type { LanguageCode } from "../lang/profiles";
export type { LanguageCode };

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
  level: "beginner" | "intermediate" | "advanced";
}

export type QuizCategory = "translation" | "vocabulary" | "grammar" | "comprehension";

/** One authoritative, transcript-backed grade from a five-question quiz. */
export interface QuizAnswer {
  type: "quiz_answer";
  language: LanguageCode;
  questionNumber: 1 | 2 | 3 | 4 | 5;
  category: QuizCategory;
  source: "review" | "general";
  question: string;
  learnerAnswer: string;
  referenceAnswer: string;
  points: 0 | 1 | 2;
  feedback: string;
}

export type ToolDetail = Correction | Phrase | PronunciationNote | PracticeLanguage | QuizAnswer;

/** Which tool produces which detail type, keyed by the tool's schema name. */
export interface ToolDetailByName {
  note_correction: Correction;
  save_phrase: Phrase;
  pronunciation_feedback: PronunciationNote;
  set_practice_language: PracticeLanguage;
  grade_quiz_answer: QuizAnswer;
}
