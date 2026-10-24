import {
  emptyStudyState,
  isToolDetail,
  type StudyState,
} from "./study";
import type {
  Correction,
  Phrase,
  PracticeLanguage,
  PronunciationNote,
} from "../tools/types";

export const STUDY_STORAGE_KEY = "polyglot.study.v1";

export interface StudyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StudyStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function detailsOfType<T extends Correction | Phrase | PronunciationNote>(
  value: unknown,
  type: T["type"],
): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => isToolDetail(item) && item.type === type);
}

function parseStoredStudy(value: unknown): StudyState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.study)) {
    return emptyStudyState();
  }

  const practice = value.study.practiceLanguage;
  return {
    corrections: detailsOfType<Correction>(value.study.corrections, "correction"),
    phrases: detailsOfType<Phrase>(value.study.phrases, "phrase"),
    pronunciationNotes: detailsOfType<PronunciationNote>(
      value.study.pronunciationNotes,
      "pronunciation",
    ),
    practiceLanguage:
      isToolDetail(practice) && practice.type === "practice_language"
        ? (practice as PracticeLanguage)
        : null,
  };
}

/** Load validated study data; unavailable or corrupt storage behaves as empty. */
export function loadStoredStudy(storage: StudyStorage | null = browserStorage()): StudyState {
  if (!storage) return emptyStudyState();
  try {
    const raw = storage.getItem(STUDY_STORAGE_KEY);
    return raw === null ? emptyStudyState() : parseStoredStudy(JSON.parse(raw));
  } catch {
    return emptyStudyState();
  }
}

/** Persist a versioned snapshot. False means storage was unavailable or refused it. */
export function saveStoredStudy(
  study: StudyState,
  storage: StudyStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STUDY_STORAGE_KEY, JSON.stringify({ version: 1, study }));
    return true;
  } catch {
    return false;
  }
}

/** Clear persisted study data without allowing a storage failure to reach the app. */
export function clearStoredStudy(storage: StudyStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(STUDY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
