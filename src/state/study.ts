import type { TranscriptItem, TranscriptState, ToolItem } from "./transcriptStore";
import type {
  Correction,
  LanguageCode,
  Phrase,
  PracticeLanguage,
  PronunciationNote,
  ToolDetail,
} from "../tools/types";
import { PROFILES } from "../lang/profiles";

export interface StudyState {
  corrections: Correction[];
  phrases: Phrase[];
  pronunciationNotes: PronunciationNote[];
  /** The most recent practice-language choice in the transcript. */
  practiceLanguage: PracticeLanguage | null;
}

const LANGUAGES = new Set<LanguageCode>(Object.keys(PROFILES) as LanguageCode[]);
const CORRECTION_KINDS = new Set<Correction["kind"]>(["grammar", "vocabulary", "other"]);
const PRONUNCIATION_ISSUES = new Set<PronunciationNote["issue"]>([
  "tone",
  "initial",
  "final",
  "other",
]);
const LEVELS = new Set<PracticeLanguage["level"]>(["beginner", "intermediate", "advanced"]);

const DETAIL_TYPE_BY_TOOL: Record<string, ToolDetail["type"]> = {
  note_correction: "correction",
  save_phrase: "phrase",
  pronunciation_feedback: "pronunciation",
  set_practice_language: "practice_language",
};
const TOOL_BY_DETAIL_TYPE: Record<ToolDetail["type"], string> = {
  correction: "note_correction",
  phrase: "save_phrase",
  pronunciation: "pronunciation_feedback",
  practice_language: "set_practice_language",
};
const STUDY_TOOL_NAMES = new Set(Object.keys(DETAIL_TYPE_BY_TOOL));

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

export function isToolDetail(value: unknown): value is ToolDetail {
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

export function emptyStudyState(): StudyState {
  return {
    corrections: [],
    phrases: [],
    pronunciationNotes: [],
    practiceLanguage: null,
  };
}

/** Rehydrate saved details as hidden tool items, keeping one transcript store. */
export function transcriptFromStudy(study: StudyState): TranscriptState {
  const details: ToolDetail[] = [
    ...study.corrections,
    ...study.phrases,
    ...study.pronunciationNotes,
  ];
  if (study.practiceLanguage) details.push(study.practiceLanguage);

  const order: string[] = [];
  const items: Record<string, TranscriptItem> = {};
  details.forEach((detail, index) => {
    const itemId = `restored-study-${index}`;
    order.push(itemId);
    items[itemId] = {
      kind: "tool",
      itemId,
      callId: `restored-study-call-${index}`,
      name: TOOL_BY_DETAIL_TYPE[detail.type],
      args: null,
      result: { summary: "Restored saved study item.", detail },
      status: "ok",
      ms: null,
      at: 0,
      restored: true,
    };
  });
  return { order, items };
}

/** Remove learning tool items while preserving the visible conversation. */
/**
 * The transcript a new session starts from: the study items only, as hidden
 * restored items, so the previous conversation doesn't clutter the new one
 * while the study panel keeps everything learned so far.
 */
export function freshSessionTranscript(state: TranscriptState): TranscriptState {
  return transcriptFromStudy(studyFromTranscript(state));
}

export function withoutStudyItems(state: TranscriptState): TranscriptState {
  const order = state.order.filter((itemId) => {
    const item = state.items[itemId];
    return item.kind !== "tool" || !STUDY_TOOL_NAMES.has(item.name);
  });
  if (order.length === state.order.length) return state;

  const items: Record<string, TranscriptItem> = {};
  for (const itemId of order) items[itemId] = state.items[itemId];
  return { order, items };
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
  const study = emptyStudyState();

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
