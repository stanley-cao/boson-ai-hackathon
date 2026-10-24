import { describe, expect, it } from "vitest";
import {
  emptyStudyState,
  studyFromTranscript,
  transcriptFromStudy,
  type StudyState,
} from "../src/state/study";
import {
  clearStoredStudy,
  loadStoredStudy,
  saveStoredStudy,
  STUDY_STORAGE_KEY,
  type StudyStorage,
} from "../src/state/studyStorage";

class MemoryStorage implements StudyStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const populatedStudy = (): StudyState => ({
  corrections: [
    {
      type: "correction",
      language: "zh",
      said: "两书",
      correct: "两本书",
      explanation: "Use the measure word 本.",
      kind: "grammar",
      romanization: "liǎng běn shū",
    },
  ],
  phrases: [
    {
      type: "phrase",
      language: "zh",
      phrase: "加油",
      meaning: "keep going",
      romanization: "jiā yóu",
    },
  ],
  pronunciationNotes: [
    {
      type: "pronunciation",
      language: "zh",
      target: "好",
      issue: "tone",
      tip: "Dip, then rise.",
      romanization: "hǎo",
    },
  ],
  practiceLanguage: {
    type: "practice_language",
    language: "zh",
    level: "beginner",
  },
});

describe("study storage", () => {
  it("round-trips a versioned study snapshot", () => {
    const storage = new MemoryStorage();
    const study = populatedStudy();

    expect(saveStoredStudy(study, storage)).toBe(true);
    const loaded = loadStoredStudy(storage);
    expect(loaded).toEqual(study);
    expect(studyFromTranscript(transcriptFromStudy(loaded))).toEqual(study);
    expect(JSON.parse(storage.values.get(STUDY_STORAGE_KEY) ?? "{}").version).toBe(1);
  });

  it("sanitizes invalid stored fields instead of trusting parsed JSON", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      STUDY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        study: {
          corrections: [{ type: "correction", language: "zh", said: "incomplete" }],
          phrases: [
            { type: "phrase", language: "zh", phrase: "谢谢", meaning: "thank you" },
          ],
          pronunciationNotes: "not-an-array",
          practiceLanguage: { type: "practice_language", language: "xx", level: "expert" },
        },
      }),
    );

    expect(loadStoredStudy(storage)).toEqual({
      corrections: [],
      phrases: [
        { type: "phrase", language: "zh", phrase: "谢谢", meaning: "thank you" },
      ],
      pronunciationNotes: [],
      practiceLanguage: null,
    });
  });

  it("returns empty study data for corrupt JSON or an unknown version", () => {
    const storage = new MemoryStorage();
    storage.setItem(STUDY_STORAGE_KEY, "{not json");
    expect(loadStoredStudy(storage)).toEqual(emptyStudyState());

    storage.setItem(STUDY_STORAGE_KEY, JSON.stringify({ version: 2, study: populatedStudy() }));
    expect(loadStoredStudy(storage)).toEqual(emptyStudyState());
  });

  it("clears the stored snapshot", () => {
    const storage = new MemoryStorage();
    saveStoredStudy(populatedStudy(), storage);

    expect(clearStoredStudy(storage)).toBe(true);
    expect(storage.values.has(STUDY_STORAGE_KEY)).toBe(false);
  });

  it("never throws when storage access is unavailable", () => {
    const unavailable: StudyStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(() => loadStoredStudy(unavailable)).not.toThrow();
    expect(loadStoredStudy(unavailable)).toEqual(emptyStudyState());
    expect(saveStoredStudy(populatedStudy(), unavailable)).toBe(false);
    expect(clearStoredStudy(unavailable)).toBe(false);
    expect(loadStoredStudy(null)).toEqual(emptyStudyState());
  });
});
