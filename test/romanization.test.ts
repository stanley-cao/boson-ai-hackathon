import { describe, expect, it } from "vitest";
import type { StudyState } from "../src/state/study";
import {
  annotateWithRomanization,
  romanizationsFromStudy,
} from "../src/ui/romanization";

const emptyStudy = (): StudyState => ({
  corrections: [],
  phrases: [],
  pronunciationNotes: [],
  practiceLanguage: null,
});

describe("romanizationsFromStudy", () => {
  it("collects pinyin for corrected, saved and pronunciation target text", () => {
    const study = emptyStudy();
    study.corrections.push({
      type: "correction",
      language: "zh",
      said: "两书",
      correct: "两本书",
      explanation: "Use the measure word 本.",
      kind: "grammar",
      romanization: "liǎng běn shū",
    });
    study.phrases.push({
      type: "phrase",
      language: "zh",
      phrase: "加油",
      meaning: "keep going",
      romanization: "jiā yóu",
    });
    study.pronunciationNotes.push({
      type: "pronunciation",
      language: "zh",
      target: "好",
      issue: "tone",
      tip: "Dip, then rise.",
      romanization: "hǎo",
    });

    expect(romanizationsFromStudy(study)).toEqual([
      { text: "两本书", romanization: "liǎng běn shū" },
      { text: "加油", romanization: "jiā yóu" },
      { text: "好", romanization: "hǎo" },
    ]);
  });

  it("ignores missing romanization, Latin-only targets and duplicate entries", () => {
    const study = emptyStudy();
    study.phrases.push(
      { type: "phrase", language: "zh", phrase: "你好", meaning: "hello" },
      {
        type: "phrase",
        language: "zh",
        phrase: "hello",
        meaning: "你好",
        romanization: "hello",
      },
      {
        type: "phrase",
        language: "zh",
        phrase: "你好",
        meaning: "hello",
        romanization: "nǐ hǎo",
      },
      {
        type: "phrase",
        language: "zh",
        phrase: "你好",
        meaning: "hello",
        romanization: "nǐ hǎo",
      },
    );

    expect(romanizationsFromStudy(study)).toEqual([
      { text: "你好", romanization: "nǐ hǎo" },
    ]);
  });
});

describe("annotateWithRomanization", () => {
  it("annotates exact matching Han text without changing surrounding text", () => {
    expect(
      annotateWithRomanization("Say 加油! 加油!", [
        { text: "加油", romanization: "jiā yóu" },
      ]),
    ).toEqual([
      { text: "Say " },
      { text: "加油", romanization: "jiā yóu" },
      { text: "! " },
      { text: "加油", romanization: "jiā yóu" },
      { text: "!" },
    ]);
  });

  it("prefers a complete phrase over an overlapping shorter match", () => {
    expect(
      annotateWithRomanization("你好", [
        { text: "你好", romanization: "nǐ hǎo" },
        { text: "好", romanization: "hǎo" },
      ]),
    ).toEqual([{ text: "你好", romanization: "nǐ hǎo" }]);
  });

  it("returns unannotated text when no supplied phrase matches", () => {
    expect(
      annotateWithRomanization("再见", [{ text: "你好", romanization: "nǐ hǎo" }]),
    ).toEqual([{ text: "再见" }]);
    expect(annotateWithRomanization("", [])).toEqual([]);
  });
});
