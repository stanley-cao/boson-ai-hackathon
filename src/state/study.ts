import type { TranscriptState, ToolItem } from "./transcriptStore";
import type {
  Correction,
  LanguageCode,
  Phrase,
  PracticeLanguage,
  PronunciationNote,
  ToolDetail,
} from "../tools/types";

export interface StudyState {
  corrections: Correction[];
  phrases: Phrase[];
  pronunciationNotes: PronunciationNote[];
  /** The most recent practice-language choice in the transcript. */
  practiceLanguage: PracticeLanguage | null;
}

const LANGUAGES = new Set<LanguageCode>(["en", "zh", "ko", "fr", "ja"]);
const CORRECTION_KINDS = new Set<Correction["kind"]>(["grammar", "vocabulary", "other"]);
const PRONUNCIATION_ISSUES = new Set<PronunciationNote["issue"]>([
  "tone",
  "initial",
  "final",
  "other",
]);
const LEVELS = new Set<PracticeLanguage["level"]>(["beginner", "intermediate"]);

const DETAIL_TYPE_BY_TOOL: Record<string, ToolDetail["type"]> = {
  note_correction: "correction",
  save_phrase: "phrase",
  pronunciation_feedback: "pronunciation",
  set_practice_language: "practice_language",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isLanguage(value: unknown): value is LanguageCode {
  return isString(value) && LANGUAGES.has(value as LanguageCode);
}

function isToolDetail(value: unknown): value is ToolDetail {
  if (!isRecord(value) || !isLanguage(value.language)) return false;

  switch (value.type) {
    case "correction":
      return (
        isString(value.said) &&
        isString(value.correct) &&
        isString(value.explanation) &&
        isString(value.kind) &&
        CORRECTION_KINDS.has(value.kind as Correction["kind"]) &&
        isOptionalString(value.romanization)
      );
    case "phrase":
      return (
        isString(value.phrase) &&
        isString(value.meaning) &&
        isOptionalString(value.romanization) &&
        isOptionalString(value.note)
      );
    case "pronunciation":
      return (
        isString(value.target) &&
        isString(value.issue) &&
        PRONUNCIATION_ISSUES.has(value.issue as PronunciationNote["issue"]) &&
        isString(value.tip) &&
        isOptionalString(value.romanization)
      );
    case "practice_language":
      return isString(value.level) && LEVELS.has(value.level as PracticeLanguage["level"]);
    default:
      return false;
  }
}

function detailFrom(item: ToolItem): ToolDetail | null {
  if (item.status !== "ok" || !isRecord(item.result)) return null;
  const detail = item.result.detail;
  if (!isToolDetail(detail)) return null;

  // A valid-looking detail attached to the wrong tool is still corrupt data.
  // Checking both prevents, for example, a correction result from appearing
  // when an unrelated or future tool happens to return the same shape.
  return DETAIL_TYPE_BY_TOOL[item.name] === detail.type ? detail : null;
}

/** Derive every study view from the transcript, without mutating its items. */
export function studyFromTranscript(state: TranscriptState): StudyState {
  const study: StudyState = {
    corrections: [],
    phrases: [],
    pronunciationNotes: [],
    practiceLanguage: null,
  };

  for (const itemId of state.order) {
    const item = state.items[itemId];
    if (item.kind !== "tool") continue;

    const detail = detailFrom(item);
    if (!detail) continue;

    switch (detail.type) {
      case "correction":
        study.corrections.push(detail);
        break;
      case "phrase":
        study.phrases.push(detail);
        break;
      case "pronunciation":
        study.pronunciationNotes.push(detail);
        break;
      case "practice_language":
        study.practiceLanguage = detail;
        break;
    }
  }

  return study;
}
