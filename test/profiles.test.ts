import { describe, expect, it } from "vitest";
import {
  ACTIVE_LEVEL,
  ACTIVE_PAIR,
  LEARNER_LEVELS,
  PROFILES,
  SCRIPT_PATTERNS,
  TARGET_LANGUAGE_CODES,
} from "../src/lang/profiles";

const HAN = /\p{Script=Han}/u;
const HANGUL = /\p{Script=Hangul}/u;
const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

describe("language profiles", () => {
  it("files every profile under its own code", () => {
    for (const [key, profile] of Object.entries(PROFILES)) {
      expect(profile.code).toBe(key);
    }
  });

  it("points the active pair at profiles that exist", () => {
    expect(PROFILES[ACTIVE_PAIR.native]).toBeDefined();
    expect(PROFILES[ACTIVE_PAIR.target]).toBeDefined();
    expect(ACTIVE_PAIR).toEqual({ native: "en", target: "zh" });
  });

  it("teaches Mandarin in Simplified characters with pinyin", () => {
    expect(PROFILES.zh.script).toBe("Hans");
    expect(PROFILES.zh.romanization).toBe("pinyin");
    for (const opener of PROFILES.zh.sampleOpeners) {
      expect(opener, opener).toMatch(HAN);
    }
  });

  it("keeps English openers free of Han text", () => {
    for (const opener of PROFILES.en.sampleOpeners) {
      expect(opener, opener).not.toMatch(HAN);
    }
  });

  it("defines Korean, French, and Japanese as data-only teaching profiles", () => {
    expect(PROFILES.ko).toMatchObject({ script: "Hang", romanization: "revised" });
    expect(PROFILES.fr).toMatchObject({ script: "Latn" });
    expect(PROFILES.fr).not.toHaveProperty("romanization");
    expect(PROFILES.ja).toMatchObject({ script: "Jpan", romanization: "hepburn" });
    expect(PROFILES.ko.sampleOpeners.every((opener) => HANGUL.test(opener))).toBe(true);
    expect(PROFILES.ja.sampleOpeners.every((opener) => JAPANESE.test(opener))).toBe(true);
  });

  it("teaches Serbian in Latin script without romanization", () => {
    expect(PROFILES.sr).toMatchObject({ name: "Serbian", script: "Latn" });
    expect(PROFILES.sr).not.toHaveProperty("romanization");
    expect(PROFILES.sr.promptNotes).toContain("seven noun cases");
    expect(PROFILES.sr.promptNotes).toContain("verb aspect pairs");
    expect(PROFILES.sr.promptNotes).toContain("č/ć and dž/đ");
    expect(PROFILES.sr.sampleOpeners).toEqual([
      "Zdravo! Šta želiš da vežbaš danas?",
      "Kako ti je prošao dan?",
    ]);
  });

  it("teaches Vietnamese in Latin script with its tone marks", () => {
    expect(PROFILES.vi).toMatchObject({ name: "Vietnamese", script: "Latn" });
    expect(PROFILES.vi).not.toHaveProperty("romanization");
    expect(PROFILES.vi.promptNotes).toContain("six tones");
    expect(PROFILES.vi.promptNotes).toContain("classifiers");
    expect(PROFILES.vi.sampleOpeners).toEqual([
      "Xin chào! Hôm nay bạn muốn luyện tập gì?",
      "Hôm nay của bạn thế nào?",
    ]);
  });

  it("keeps promptNotes short and gives every language openers", () => {
    // promptNotes go into the system prompt, and a long prompt stops the
    // model calling tools (see CLAUDE.md). The cap is a tripwire, not a target.
    for (const profile of Object.values(PROFILES)) {
      expect(profile.promptNotes.length, profile.code).toBeGreaterThan(0);
      expect(profile.promptNotes.length, profile.code).toBeLessThanOrEqual(300);
      expect(profile.sampleOpeners.length, profile.code).toBeGreaterThan(0);
    }
  });

  it("has every top-tier Higgs TTS 3 language: 85 profiles, 84 of them targets", () => {
    expect(Object.keys(PROFILES)).toHaveLength(85);
    expect(TARGET_LANGUAGE_CODES).toHaveLength(84);
    expect(TARGET_LANGUAGE_CODES).not.toContain("en");
    expect(new Set(Object.values(PROFILES).map((p) => p.name)).size).toBe(85);
  });

  it("lists target languages A to Z by name, for the picker", () => {
    const names = TARGET_LANGUAGE_CODES.map((code) => PROFILES[code].name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(names.slice(0, 3)).toEqual(["Afrikaans", "Arabic", "Armenian"]);
  });

  it("writes every non-Latin language's openers in its own script", () => {
    for (const profile of Object.values(PROFILES)) {
      if (profile.script === "Latn") continue;
      const script = SCRIPT_PATTERNS[profile.script];
      expect(script, profile.code).toBeDefined();
      for (const opener of profile.sampleOpeners) expect(opener, profile.code).toMatch(script!.pattern);
    }
  });

  it("keeps Latin-script openers free of other scripts", () => {
    const other = Object.values(SCRIPT_PATTERNS).map((s) => s.pattern);
    for (const profile of Object.values(PROFILES)) {
      if (profile.script !== "Latn") continue;
      for (const opener of profile.sampleOpeners) {
        for (const pattern of other) expect(opener, profile.code).not.toMatch(pattern);
      }
    }
  });

  it("defines distinct beginner and intermediate guidance with a valid default", () => {
    expect(Object.keys(LEARNER_LEVELS)).toEqual(["beginner", "intermediate"]);
    expect(LEARNER_LEVELS[ACTIVE_LEVEL]).toBeDefined();
    expect(ACTIVE_LEVEL).toBe("beginner");
    expect(LEARNER_LEVELS.beginner.promptNotes).toContain("Speak slowly");
    expect(LEARNER_LEVELS.beginner.promptNotes).toContain("what it means in English");
    expect(LEARNER_LEVELS.intermediate.promptNotes).toContain("natural but clear pace");
    expect(LEARNER_LEVELS.intermediate.promptNotes).toContain("mostly the target language");
  });
});
