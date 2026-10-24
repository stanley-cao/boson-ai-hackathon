import { PROFILES } from "../lang/profiles";
import type { Correction, PracticeLanguage, PronunciationNote, ToolDetail } from "./types";

/**
 * The result shape every tool returns.
 *
 * `summary` is written to be SPOKEN. `detail` is the structured data behind it.
 * Both go back to the model, and the split matters more than it looks — see the
 * "shaping results for a voice" section of docs/part-4.md.
 *
 * `detail` is one of the shapes in ./types.ts, which is what the study panel
 * renders from, so a handler cannot hand the UI something it doesn't know.
 */
export interface ToolResult {
  summary: string;
  detail?: ToolDetail;
  error?: string;
}

type ProfileCode = keyof typeof PROFILES;

// Names a model is likely to send for each profile. The schema enum says "zh",
// but models also say the language's name or a locale tag, so both map here.
const LANGUAGE_ALIASES: Record<string, ProfileCode> = {
  en: "en",
  english: "en",
  zh: "zh",
  mandarin: "zh",
  chinese: "zh",
  "mandarin chinese": "zh",
};

/**
 * Normalise a language argument to a profile code, or `null` if we don't
 * recognise it. An unknown value means "no language given", never a thrown
 * error or a guessed language.
 *
 * Locale tags such as "zh-CN" or "en_US" fall back to their base subtag, so
 * "zh-Hant" also maps to `zh`. We only have Simplified-character teaching
 * notes today, so that is a deliberate simplification.
 */
export function normalizeLanguage(raw: unknown): ProfileCode | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/_/g, "-");
  if (Object.hasOwn(LANGUAGE_ALIASES, t)) return LANGUAGE_ALIASES[t];
  const base = t.split("-")[0];
  if (Object.hasOwn(LANGUAGE_ALIASES, base)) return LANGUAGE_ALIASES[base];
  return null;
}

/**
 * A text argument, trimmed, or `null` if it is missing or blank. Blank counts
 * as missing so that an optional field sent as "" never becomes an empty line
 * on a study card.
 */
function normalizeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t : null;
}

// What a model may call each correction kind besides the enum value itself.
// Anything else files as "other": a mislabelled kind should still save the
// correction, not lose it.
const CORRECTION_KINDS: Record<string, Correction["kind"]> = {
  grammar: "grammar",
  grammatical: "grammar",
  "word order": "grammar",
  "measure word": "grammar",
  particle: "grammar",
  vocabulary: "vocabulary",
  vocab: "vocabulary",
  word: "vocabulary",
  "word choice": "vocabulary",
};

function normalizeCorrectionKind(raw: unknown): Correction["kind"] {
  if (typeof raw !== "string") return "other";
  // "Word_Order" -> "word order", "measure words" -> "measure word".
  const t = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/s$/, "");
  return Object.hasOwn(CORRECTION_KINDS, t) ? CORRECTION_KINDS[t] : "other";
}

/**
 * Record a correction for the study panel.
 *
 * The schema tells the model to call this BEFORE it speaks, so the summary is
 * its cue for what to say next rather than a line to read out. Verified
 * 2026-10-23 with the probe: "call this in the same turn as you correct"
 * descriptions were called in 9 of 37 runs, while "call this first" was
 * called in 24 of 24.
 */
export function noteCorrection(args: Record<string, unknown>): ToolResult {
  const language = normalizeLanguage(args.language);
  if (!language) {
    return {
      summary: `Correction not saved: language must be one of ${Object.keys(PROFILES).join(", ")}.`,
      error: "unknown_language",
    };
  }

  const said = normalizeText(args.said);
  const correct = normalizeText(args.correct);
  if (!said || !correct) {
    return {
      summary: "Correction not saved: it needs what the learner said and the corrected version.",
      error: "missing_fields",
    };
  }

  const romanization = normalizeText(args.romanization);
  const detail: Correction = {
    type: "correction",
    language,
    said,
    correct,
    // The tutor has already explained it aloud, so a card without the reason
    // is still worth keeping.
    explanation: normalizeText(args.explanation) ?? "",
    kind: normalizeCorrectionKind(args.kind),
    ...(romanization ? { romanization } : {}),
  };
  return {
    summary: `Saved. Now briefly tell the learner the correct version, ${correct}, and why, then carry on the conversation.`,
    detail,
  };
}

// What a model may call each level besides the enum value itself.
const LEVELS: Record<string, PracticeLanguage["level"]> = {
  beginner: "beginner",
  novice: "beginner",
  basic: "beginner",
  intermediate: "intermediate",
  advanced: "advanced",
  fluent: "advanced",
};

/**
 * The level, or "beginner" when the model sent none we recognise. The summary
 * says the level aloud, so a wrong default is heard and can be corrected.
 */
function normalizeLevel(raw: unknown): PracticeLanguage["level"] {
  if (typeof raw !== "string") return "beginner";
  const t = raw.trim().toLowerCase().replace(/s$/, ""); // "Beginners" -> "beginner"
  return Object.hasOwn(LEVELS, t) ? LEVELS[t] : "beginner";
}

/**
 * Switch the language or level being practised, for the "practising" badge.
 *
 * A language without a profile is an error rather than a silent switch: the
 * tutor has no teaching notes for it yet, and the summary names the languages
 * it does have, so the model can offer those instead.
 */
export function setPracticeLanguage(args: Record<string, unknown>): ToolResult {
  const language = normalizeLanguage(args.language);
  if (!language) {
    const names = Object.values(PROFILES)
      .map((p) => p.name)
      .join(" or ");
    return {
      summary: `That language isn't available yet. The learner can practise ${names}.`,
      error: "unknown_language",
    };
  }

  const level = normalizeLevel(args.level);
  const detail: PracticeLanguage = { type: "practice_language", language, level };
  return {
    summary: `Now practising ${PROFILES[language].name} at ${level} level. Confirm that to the learner in a few words, then carry on the conversation.`,
    detail,
  };
}

// Words that name each pronunciation issue. Anything else files as "other":
// a mislabelled issue should still save the note, not lose it.
const PRONUNCIATION_ISSUES: Record<string, PronunciationNote["issue"]> = {
  tone: "tone",
  tonal: "tone",
  initial: "initial",
  consonant: "initial",
  final: "final",
  vowel: "final",
};

function normalizePronunciationIssue(raw: unknown): PronunciationNote["issue"] {
  if (typeof raw !== "string") return "other";
  // Word by word, so "Tones", "wrong tone" and "tone_error" all file as tone.
  for (const word of raw.toLowerCase().split(/[\s_-]+/)) {
    const w = word.replace(/s$/, "");
    if (Object.hasOwn(PRONUNCIATION_ISSUES, w)) return PRONUNCIATION_ISSUES[w];
  }
  return "other";
}

/**
 * Save a pronunciation note: the Mandarin showcase, since the model hears the
 * learner's tones directly rather than through a transcript.
 *
 * The schema tells the model to call this BEFORE it speaks, so the summary is
 * its cue for what to say next rather than a line to read out: a "same turn"
 * description was called far less reliably in live probes.
 */
export function pronunciationFeedback(args: Record<string, unknown>): ToolResult {
  const language = normalizeLanguage(args.language);
  if (!language) {
    return {
      summary: `Note not saved: language must be one of ${Object.keys(PROFILES).join(", ")}.`,
      error: "unknown_language",
    };
  }

  const target = normalizeText(args.target);
  const tip = normalizeText(args.tip);
  if (!target || !tip) {
    return {
      summary: "Note not saved: it needs the word or syllable and a tip.",
      error: "missing_fields",
    };
  }

  const romanization = normalizeText(args.romanization);
  const detail: PronunciationNote = {
    type: "pronunciation",
    language,
    target,
    issue: normalizePronunciationIssue(args.issue),
    tip,
    ...(romanization ? { romanization } : {}),
  };
  return {
    summary: `Saved a pronunciation note for ${target}. Now say it the right way, give the tip in a few words, then carry on the conversation.`,
    detail,
  };
}

export const handlers: Record<string, (args: Record<string, unknown>) => ToolResult> = {
  note_correction: noteCorrection,
  set_practice_language: setPracticeLanguage,
  pronunciation_feedback: pronunciationFeedback,
};
