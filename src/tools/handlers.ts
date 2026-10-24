import { PROFILES } from "../lang/profiles";
import type { Correction, ToolDetail } from "./types";

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
    summary: `Saved. Say the corrected version clearly exactly once: ${correct} Then briefly explain why and carry on the conversation.`,
    detail,
  };
}

export const handlers: Record<string, (args: Record<string, unknown>) => ToolResult> = {
  note_correction: noteCorrection,
};
