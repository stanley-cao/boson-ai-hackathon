import { describe, expect, expectTypeOf, it } from "vitest";
import { dispatch } from "../src/tools/registry";
import {
  noteCorrection,
  normalizeLanguage,
  setPracticeLanguage,
  pronunciationFeedback,
  savePhrase,
  targetLanguageNames,
} from "../src/tools/handlers";
import { TOOL_DEFINITIONS } from "../src/tools/definitions";
import { PROFILES } from "../src/lang/profiles";
import {
  CLIENT_TOOL_RESULT,
  emptyTranscript,
  toList,
  transcriptReducer,
} from "../src/state/transcriptStore";
import type { ServerEvent } from "../src/realtime/events";
import type {
  Correction,
  PracticeLanguage,
  Phrase,
  PronunciationNote,
  ToolDetail,
  ToolDetailByName,
} from "../src/tools/types";

describe("dispatch", () => {
  it("answers for a tool that does not exist instead of throwing", async () => {
    // The model can recover from an answer. It cannot recover from silence.
    const r = await dispatch("order_a_pizza", {});
    expect(r.error).toBe("unknown_tool");
    expect(r.summary).toContain("order_a_pizza");
  });
});

describe("normalizeLanguage", () => {
  it("maps Mandarin, in any spelling the model uses, to zh", () => {
    for (const sent of ["Mandarin", "Chinese", "zh-CN", "ZH", "zh", " Mandarin Chinese ", "zh_cn"]) {
      expect(normalizeLanguage(sent), JSON.stringify(sent)).toBe("zh");
    }
  });

  it("maps English, in any spelling the model uses, to en", () => {
    for (const sent of ["English", "en", "EN", "en-US", "en_GB"]) {
      expect(normalizeLanguage(sent), JSON.stringify(sent)).toBe("en");
    }
  });

  it("maps the Phase 3 target names and locale tags to their profiles", () => {
    const cases = [
      ["Korean", "ko"],
      ["ko-KR", "ko"],
      ["French", "fr"],
      ["fr-FR", "fr"],
      ["Japanese", "ja"],
      ["ja-JP", "ja"],
    ] as const;
    for (const [sent, expected] of cases) expect(normalizeLanguage(sent)).toBe(expected);
  });

  it("maps Serbian names and either script locale tag to sr", () => {
    for (const sent of ["sr", "sr-Latn", "sr-Cyrl", "Serbian", "srpski"]) {
      expect(normalizeLanguage(sent), sent).toBe("sr");
    }
  });

  it("maps Vietnamese names, with or without diacritics, and its locale tag to vi", () => {
    for (const sent of ["vi", "vi-VN", "Vietnamese", "Tiếng Việt", "tieng viet"]) {
      expect(normalizeLanguage(sent), sent).toBe("vi");
    }
  });

  it("maps the names and locale tags of Boson's other languages", () => {
    const cases = [
      ["German", "de"],
      ["de-DE", "de"],
      ["pt_BR", "pt"],
      ["Māori", "mi"],
      ["maori", "mi"],
      ["Farsi", "fa"],
      ["Haitian Creole", "ht"],
      ["Slovenian", "sl"],
      ["español", "es"],
      ["espanol", "es"],
      ["ceb", "ceb"],
    ] as const;
    for (const [sent, expected] of cases) expect(normalizeLanguage(sent), sent).toBe(expected);
  });

  it("exports names but not codes for the agent, which matches them in speech", () => {
    const names = targetLanguageNames();
    expect(Object.keys(names)).not.toContain("en");
    expect(names.it).toEqual(["italian"]);
    expect(names.mi).toEqual(["māori", "maori"]);
    expect(Object.values(names).flat()).not.toContain("no");
  });

  it("returns null for values it does not know, rather than guessing", () => {
    // Welsh is one of the languages Boson rates below its top tier, left out on purpose.
    for (const sent of ["Klingon", "Welsh", "", "  ", "Chinese (Simplified)"]) {
      expect(normalizeLanguage(sent), JSON.stringify(sent)).toBeNull();
    }
  });

  it("never throws on non-string arguments", () => {
    for (const sent of [undefined, null, 42, { code: "zh" }, ["zh"]]) {
      expect(normalizeLanguage(sent), String(sent)).toBeNull();
    }
  });
});

describe("note_correction", () => {
  const args = {
    language: "Mandarin",
    said: " 我有三本狗。 ",
    correct: "我有三只狗。",
    explanation: "狗 takes the measure word 只, not 本.",
    kind: "Measure words",
    romanization: "wǒ yǒu sān zhī gǒu",
  };

  it("saves a correction with the language normalised and the text trimmed", () => {
    const r = noteCorrection(args);
    expect(r.error).toBeUndefined();
    expect(r.summary).toContain("我有三只狗。");
    expect(r.detail).toEqual({
      type: "correction",
      language: "zh",
      said: "我有三本狗。",
      correct: "我有三只狗。",
      explanation: "狗 takes the measure word 只, not 本.",
      kind: "grammar",
      romanization: "wǒ yǒu sān zhī gǒu",
    });
  });

  it("instructs the tutor to say the corrected version clearly exactly once", () => {
    const result = noteCorrection(args);
    const definition = TOOL_DEFINITIONS.find((tool) => tool.name === "note_correction");

    expect(result.summary).toContain("clearly exactly once");
    expect(result.summary.match(/\u6211\u6709\u4e09\u53ea\u72d7\u3002/g)).toHaveLength(1);
    expect(definition?.description).toContain("say the `correct` text clearly exactly once");
  });

  it("files a kind it does not recognise as other, rather than losing the correction", () => {
    const cases: [unknown, Correction["kind"]][] = [
      ["Grammar", "grammar"],
      ["word_order", "grammar"],
      ["VOCAB", "vocabulary"],
      ["tones", "other"],
      ["constructor", "other"],
      [42, "other"],
      [undefined, "other"],
    ];
    for (const [sent, kind] of cases) {
      const d = noteCorrection({ ...args, kind: sent }).detail as Correction;
      expect(d.kind, String(sent)).toBe(kind);
    }
  });

  it("leaves out a blank romanization and keeps a missing explanation empty", () => {
    const d = noteCorrection({ ...args, romanization: "  ", explanation: undefined }).detail as Correction;
    expect(d).not.toHaveProperty("romanization");
    expect(d.explanation).toBe("");
  });

  it("answers with an error, never a throw, when the language is unknown", () => {
    for (const language of ["Klingon", undefined, 7]) {
      const r = noteCorrection({ ...args, language });
      expect(r.error, String(language)).toBe("unknown_language");
      expect(r.summary).toContain(Object.keys(PROFILES).join(", "));
      expect(r.detail).toBeUndefined();
    }
  });

  it("answers with an error when what was said or the fix is missing", () => {
    for (const missing of ["said", "correct"]) {
      const r = noteCorrection({ ...args, [missing]: "" });
      expect(r.error, missing).toBe("missing_fields");
      expect(r.detail).toBeUndefined();
    }
  });

  it("refuses a correction that changes nothing but case, spacing or punctuation", () => {
    const cases: [string, string, string][] = [
      ["zh", "我有三本狗。", " 我有三本狗 "],
      ["zh", "mā hē mā", "mā hē mā"],
      ["en", "I goed home", "i goed home!"],
    ];
    for (const [language, said, correct] of cases) {
      const r = noteCorrection({ ...args, language, said, correct });
      expect(r.error, correct).toBe("same_as_said");
      expect(r.detail).toBeUndefined();
    }
  });

  it("refuses a Mandarin correction written in pinyin instead of characters", () => {
    for (const correct of ["wǒ", "wo3 you3 san1 zhi1 gou3"]) {
      const r = noteCorrection({ ...args, said: "我", correct });
      expect(r.error, correct).toBe("wrong_script");
      expect(r.summary).toContain("Chinese characters");
      expect(r.detail).toBeUndefined();
    }
  });

  it("refuses a correction in Latin letters for the newer non-Latin scripts", () => {
    const cases = [
      ["ru", "Я студент", "Ya student", "Cyrillic"],
      ["hi", "मैं छात्र हूँ", "main chhatra hoon", "Devanagari"],
      ["ar", "أنا طالب", "ana talib", "Arabic script"],
      ["th", "ฉันเป็นนักเรียน", "chan pen nakrian", "Thai script"],
    ] as const;
    for (const [language, said, correct, name] of cases) {
      const wrong = noteCorrection({ ...args, language, said, correct });
      expect(wrong.error, language).toBe("wrong_script");
      expect(wrong.summary).toContain(name);
      // The same fix in the language's own script is saved.
      expect(noteCorrection({ ...args, language, said: correct, correct: said }).detail, language).toBeDefined();
    }
  });

  it("still saves a mixed-language Mandarin fix, and an English one in Latin letters", () => {
    expect(noteCorrection({ ...args, said: "I have 三本狗", correct: "I have 三只狗" }).detail).toBeDefined();
    expect(
      noteCorrection({ ...args, language: "en", said: "I goed home", correct: "I went home" }).detail,
    ).toBeDefined();
  });

  it("is registered, so dispatch reaches it", async () => {
    const r = await dispatch("note_correction", args);
    expect(r.detail?.type).toBe("correction");
  });

  it("is offered with every profile language and the fields a card needs", () => {
    expect(TOOL_DEFINITIONS.find((d) => d.name === "note_correction")).toMatchObject({
      parameters: {
        properties: { language: { enum: Object.keys(PROFILES) } },
        required: ["language", "said", "correct", "explanation", "kind"],
      },
    });
  });

  it("replaces the tutorial's dummy web_search", () => {
    expect(TOOL_DEFINITIONS.map((d) => d.name)).not.toContain("web_search");
  });
});

describe("set_practice_language", () => {
  it("accepts the new target profiles", () => {
    expect(setPracticeLanguage({ language: "Korean", level: "beginner" }).detail).toMatchObject({
      language: "ko",
    });
    expect(setPracticeLanguage({ language: "fr-FR", level: "intermediate" }).detail).toMatchObject({
      language: "fr",
    });
    expect(setPracticeLanguage({ language: "Japanese", level: "advanced" }).detail).toMatchObject({
      language: "ja",
    });
  });

  it("switches language and level, normalising both", () => {
    const r = setPracticeLanguage({ language: "Chinese", level: "Intermediate" });
    expect(r.error).toBeUndefined();
    expect(r.summary).toContain("Mandarin Chinese at intermediate level");
    expect(r.detail).toEqual({ type: "practice_language", language: "zh", level: "intermediate" });
  });

  it("falls back to beginner for a level it does not recognise, and says so", () => {
    const cases: [unknown, PracticeLanguage["level"]][] = [
      ["advanced", "advanced"],
      ["Fluent", "advanced"],
      ["Beginners", "beginner"],
      ["novice", "beginner"],
      ["expert-ish", "beginner"],
      ["constructor", "beginner"],
      [2, "beginner"],
      [undefined, "beginner"],
    ];
    for (const [sent, level] of cases) {
      const r = setPracticeLanguage({ language: "zh", level: sent });
      expect((r.detail as PracticeLanguage).level, String(sent)).toBe(level);
      expect(r.summary).toContain(`${level} level`);
    }
  });

  it("answers with an error, never a throw, for a language without a profile", () => {
    for (const language of ["Klingon", "Welsh", "", undefined, { code: "zh" }]) {
      const r = setPracticeLanguage({ language, level: "beginner" });
      expect(r.error, String(language)).toBe("unknown_language");
      // Spoken, so it must not read out all 85 language names.
      expect(r.summary).not.toContain(PROFILES.ru.name);
      expect(r.summary.length).toBeLessThan(160);
      expect(r.detail).toBeUndefined();
    }
  });

  it("is registered, so dispatch reaches it", async () => {
    const r = await dispatch("set_practice_language", { language: "en", level: "advanced" });
    expect(r.detail).toEqual({ type: "practice_language", language: "en", level: "advanced" });
  });

  it("is offered all three levels, and a free-text language it can refuse", () => {
    const def = TOOL_DEFINITIONS.find((d) => d.name === "set_practice_language");
    expect(def).toMatchObject({
      parameters: {
        properties: { level: { enum: ["beginner", "intermediate", "advanced"] } },
        required: ["language", "level"],
      },
    });
    // Free text still lets the handler refuse languages that have no profile.
    expect(def?.parameters.properties.language).not.toHaveProperty("enum");
  });

  it("is reserved for explicit language or level changes", () => {
    const def = TOOL_DEFINITIONS.find((d) => d.name === "set_practice_language");

    expect(def?.description).toContain("explicitly asks for a different language");
    expect(def?.description).toContain("explicitly states a new level");
    expect(def?.description).toContain(
      "Do NOT call this merely because they name or ask to practise their current language",
    );
    expect(def?.description).toContain("Never infer a new level");

    // Keep #13's real-switch contract intact: the handler still receives both
    // the requested language and one of the three supported levels.
    expect(def?.parameters).toMatchObject({
      properties: { level: { enum: ["beginner", "intermediate", "advanced"] } },
      required: ["language", "level"],
    });
  });
});

describe("pronunciation_feedback", () => {
  const args = {
    language: "Mandarin",
    target: " 妈 ",
    romanization: "mā",
    issue: "Tones",
    tip: "Keep your voice high and level, as if singing one note.",
  };

  it("saves a note with the language and issue normalised", () => {
    const r = pronunciationFeedback(args);
    expect(r.error).toBeUndefined();
    expect(r.summary).toContain("妈");
    expect(r.detail).toEqual({
      type: "pronunciation",
      language: "zh",
      target: "妈",
      romanization: "mā",
      issue: "tone",
      tip: "Keep your voice high and level, as if singing one note.",
    });
  });

  it("files an issue it does not recognise as other, rather than losing the note", () => {
    const cases: [unknown, PronunciationNote["issue"]][] = [
      ["tone", "tone"],
      ["wrong tone", "tone"],
      ["tone_error", "tone"],
      ["Initials", "initial"],
      ["initial consonant", "initial"],
      ["final", "final"],
      ["vowels", "final"],
      ["rhythm", "other"],
      ["constructor", "other"],
      [3, "other"],
      [undefined, "other"],
    ];
    for (const [sent, issue] of cases) {
      const d = pronunciationFeedback({ ...args, issue: sent }).detail as PronunciationNote;
      expect(d.issue, String(sent)).toBe(issue);
    }
  });

  it("keeps pinyin tone marks exactly as sent, and leaves out a blank romanization", () => {
    expect((pronunciationFeedback({ ...args, romanization: "nǐ hǎo" }).detail as PronunciationNote).romanization).toBe(
      "nǐ hǎo",
    );
    expect(pronunciationFeedback({ ...args, romanization: "" }).detail).not.toHaveProperty("romanization");
  });

  it("states the contour of each tone mark in the summary the tutor speaks from", () => {
    const cases: [string, string, string][] = [
      ["妈", "mā", "mā, first tone: high and level"],
      ["麻", "má", "má, second tone: rising"],
      ["马", "mǎ", "mǎ, third tone: low and dipping"],
      ["骂", "mà", "mà, fourth tone: sharply falling"],
    ];
    for (const [target, romanization, contour] of cases) {
      const r = pronunciationFeedback({ ...args, target, romanization, tip: "Listen and copy me." });
      expect(r.summary, romanization).toContain(contour);
      expect((r.detail as PronunciationNote).tip).toBe("Listen and copy me.");
    }
  });

  it("replaces a tip that describes a different tone, as in the live run behind #55", () => {
    const r = pronunciationFeedback({
      ...args,
      romanization: "mā",
      tip: "Try raising your pitch steadily from mid to high, like a question in English.",
    });
    expect((r.detail as PronunciationNote).tip).toBe("Start high and keep it level.");
    expect(r.summary).toContain("mā, first tone: high and level");
    expect(r.summary).toContain("Your tip described a different tone");

    // A negation only hides the movement it negates.
    const mixed = pronunciationFeedback({ ...args, romanization: "má", tip: "It's not a rising tone; it's falling." });
    expect((mixed.detail as PronunciationNote).tip).toBe("Start in the middle and rise, as if asking a question.");
  });

  it("keeps a tip that fits the tone", () => {
    const cases: [string, string][] = [
      ["mā", "Keep it high and flat."],
      ["má", "Let your voice rise, as if asking a question."],
      ["mǎ", "Dip down low, then come back up."],
      ["mà", "Drop sharply, like a firm command."],
      // Live: a correct tip that names the movements it rules out.
      ["mā", "The first tone is high and level, like a flat note. Try saying it without dipping or rising."],
      ["mā", "Keep it high; don’t let it rise or fall."],
    ];
    for (const [romanization, tip] of cases) {
      const r = pronunciationFeedback({ ...args, romanization, tip });
      expect((r.detail as PronunciationNote).tip, romanization).toBe(tip);
      expect(r.summary).not.toContain("replaced");
    }
  });

  it("reads a neutral-tone syllable once tone marks are in use", () => {
    const tip = "Say the second one lightly.";
    expect(pronunciationFeedback({ ...args, target: "谢谢", romanization: "xiè xie", tip }).summary).toContain(
      "xiè, fourth tone: sharply falling; xie, neutral tone: short and light",
    );
    // Written as one word, each vowel cluster is still its own syllable.
    expect(pronunciationFeedback({ ...args, target: "妈妈", romanization: "māma", tip }).summary).toContain(
      "māma, first tone: high and level, then neutral tone: short and light",
    );
  });

  it("reads tones the way models send them: numbers, capitals, decomposed accents, a breve", () => {
    const contourOf = (romanization: string) => pronunciationFeedback({ ...args, romanization, tip: "Listen." }).summary;
    expect(contourOf("ma1")).toContain("first tone");
    expect(contourOf("ma5")).toContain("neutral tone");
    expect(contourOf("MĀ")).toContain("first tone");
    expect(contourOf("mā")).toContain("first tone");
    expect(contourOf("mă")).toContain("third tone");
  });

  it("states no contour and keeps the tip when it can't tell the tone", () => {
    // Missing, unmarked (a neutral tone, or a mark the model left out?), or not
    // plain pinyin.
    for (const romanization of [undefined, "", "ma", "妈", "mā (first tone)"]) {
      const r = pronunciationFeedback({ ...args, romanization, tip: "Try raising your pitch." });
      expect(r.summary, String(romanization)).not.toContain("tone:");
      expect((r.detail as PronunciationNote).tip).toBe("Try raising your pitch.");
    }
  });

  it("files issues in each language's own terms", () => {
    const cases: [string, unknown, PronunciationNote["issue"]][] = [
      ["zh", "consonant", "initial"],
      ["zh", "vowel", "final"],
      ["zh", "pitch", "tone"],
      ["fr", "final", "vowel"],
      ["fr", "initial consonant", "consonant"],
      ["fr", "tone", "pitch"],
      ["fr", "liaison", "other"],
      ["ko", "Stress", "stress"],
      ["ja", "pitch accent", "pitch"],
      ["ja", "tones", "pitch"],
      ["sr", "accent", "pitch"],
      ["vi", "tone", "tone"],
      ["vi", "pitch", "tone"],
      ["vi", "final", "vowel"],
      ["th", "pitch", "tone"],
      ["zu", "pitch", "tone"],
      ["de", "tone", "pitch"],
      ["ru", "final", "vowel"],
    ];
    for (const [language, sent, issue] of cases) {
      const d = pronunciationFeedback({ ...args, language, issue: sent }).detail as PronunciationNote;
      expect(d.issue, `${language} ${String(sent)}`).toBe(issue);
    }
  });

  it("states the Vietnamese tone from the mark, and replaces a tip that contradicts it", () => {
    const vi = { ...args, language: "vi", romanization: undefined, issue: "tone" };
    const r = pronunciationFeedback({ ...vi, target: "mà", tip: "Rise sharply, like a question." });
    expect(r.summary).toContain("mà, falling tone (huyền): low and gently falling");
    expect((r.detail as PronunciationNote).tip).toBe("Start low and let it fall gently.");
    const ok = pronunciationFeedback({ ...vi, target: "má", tip: "Let it rise sharply." });
    expect(ok.summary).toContain("má, rising tone (sắc)");
    expect((ok.detail as PronunciationNote).tip).toBe("Let it rise sharply.");
  });

  it("reads one Vietnamese tone per word, with vowel marks that aren't tones", () => {
    // ơ and ư carry a horn, ê a circumflex: vowel marks, so these are level.
    const r = pronunciationFeedback({ ...args, language: "vi", issue: "tone", target: "cơm", tip: "Listen." });
    expect(r.summary).toContain("cơm, level tone (ngang)");
    const two = pronunciationFeedback({ ...args, language: "vi", issue: "tone", target: "Việt Nam", tip: "Listen." });
    expect(two.summary).toContain("việt, heavy tone (nặng)");
    expect(two.summary).toContain("nam, level tone (ngang)");
  });

  it("states no Vietnamese contour when there are no marks to read it from", () => {
    // "ma" may be level, or a model that dropped every diacritic.
    for (const target of ["ma", "xin chao", "ma 2"]) {
      const r = pronunciationFeedback({ ...args, language: "vi", issue: "tone", target, tip: "Rise." });
      expect(r.summary, target).not.toContain("tone:");
      expect((r.detail as PronunciationNote).tip).toBe("Rise.");
    }
  });

  it("leaves notes about initials and finals alone", () => {
    const tip = "Curl your tongue back, and let it rise.";
    const r = pronunciationFeedback({ ...args, issue: "initial", romanization: "zhī", tip });
    expect(r.summary).not.toContain("tone:");
    expect((r.detail as PronunciationNote).tip).toBe(tip);
  });

  it("answers with an error, never a throw, when the language is unknown", () => {
    for (const language of ["Klingon", undefined, null]) {
      const r = pronunciationFeedback({ ...args, language });
      expect(r.error, String(language)).toBe("unknown_language");
      expect(r.summary).toContain(Object.keys(PROFILES).join(", "));
      expect(r.detail).toBeUndefined();
    }
  });

  it("answers with an error when the target or the tip is missing", () => {
    for (const missing of ["target", "tip"]) {
      const r = pronunciationFeedback({ ...args, [missing]: "   " });
      expect(r.error, missing).toBe("missing_fields");
      expect(r.detail).toBeUndefined();
    }
  });

  it("is registered, so dispatch reaches it", async () => {
    const r = await dispatch("pronunciation_feedback", args);
    expect((r.detail as PronunciationNote).type).toBe("pronunciation");
  });

  it("tells the tutor in its description to say the target clearly exactly once", () => {
    const definition = TOOL_DEFINITIONS.find((tool) => tool.name === "pronunciation_feedback");
    expect(definition?.description).toContain("say the `target` clearly exactly once");
  });

  it("is offered with every profile language and the fields a card needs", () => {
    expect(TOOL_DEFINITIONS.find((d) => d.name === "pronunciation_feedback")).toMatchObject({
      parameters: {
        properties: {
          language: { enum: Object.keys(PROFILES) },
          issue: { enum: ["tone", "initial", "final", "consonant", "vowel", "stress", "pitch", "other"] },
        },
        required: ["language", "target", "issue", "tip"],
      },
    });
  });
});

describe("save_phrase", () => {
  const args = {
    language: "zh-CN",
    phrase: " 加油 ",
    meaning: "Keep going! / You can do it!",
    romanization: "jiā yóu",
    note: "Said to cheer someone on.",
  };

  it("saves a phrase with the language normalised and the text trimmed", () => {
    const r = savePhrase(args);
    expect(r.error).toBeUndefined();
    expect(r.summary).toContain("加油");
    expect(r.detail).toEqual({
      type: "phrase",
      language: "zh",
      phrase: "加油",
      meaning: "Keep going! / You can do it!",
      romanization: "jiā yóu",
      note: "Said to cheer someone on.",
    });
  });

  it("drops a romanization for a language written in Latin script", () => {
    // Live, a French correction came back with made-up pinyin.
    const d = noteCorrection({
      language: "fr",
      said: "Je suis allé à la plage avec mon amis.",
      correct: "Je suis allé à la plage avec mon ami.",
      kind: "grammar",
      romanization: "zhè shì yī gè chūcún de shīfàn.",
    }).detail as Correction;
    expect(d.correct).toBe("Je suis allé à la plage avec mon ami.");
    expect(d).not.toHaveProperty("romanization");
    expect(savePhrase({ ...args, language: "sr", phrase: "Hvala" }).detail).not.toHaveProperty("romanization");
    // Kept for a non-Latin script without a named romanization system.
    expect(savePhrase({ ...args, language: "ru", phrase: "Спасибо", romanization: "spasibo" }).detail).toHaveProperty(
      "romanization",
      "spasibo",
    );
  });

  it("leaves out a blank or missing romanization and note", () => {
    const d = savePhrase({ ...args, romanization: " ", note: undefined }).detail as Phrase;
    expect(d).not.toHaveProperty("romanization");
    expect(d).not.toHaveProperty("note");
  });

  it("answers with an error, never a throw, when the language is unknown", () => {
    for (const language of ["Klingon", undefined, ["zh"]]) {
      const r = savePhrase({ ...args, language });
      expect(r.error, String(language)).toBe("unknown_language");
      expect(r.summary).toContain(Object.keys(PROFILES).join(", "));
      expect(r.detail).toBeUndefined();
    }
  });

  it("answers with an error when the phrase or its meaning is missing", () => {
    for (const missing of ["phrase", "meaning"]) {
      const r = savePhrase({ ...args, [missing]: 42 });
      expect(r.error, missing).toBe("missing_fields");
      expect(r.detail).toBeUndefined();
    }
  });

  it("is registered, so dispatch reaches it", async () => {
    const r = await dispatch("save_phrase", args);
    expect((r.detail as Phrase).type).toBe("phrase");
  });

  it("is offered with every profile language and the fields a card needs", () => {
    expect(TOOL_DEFINITIONS.find((d) => d.name === "save_phrase")).toMatchObject({
      parameters: {
        properties: { language: { enum: Object.keys(PROFILES) } },
        required: ["language", "phrase", "meaning"],
      },
    });
  });
});

describe("tool calls in the transcript", () => {
  const evt = (e: Record<string, unknown>) => e as ServerEvent;

  it("goes running -> ok, keyed by call_id", () => {
    let s = emptyTranscript;
    s = transcriptReducer(
      s,
      evt({
        type: "response.output_item.added",
        item: { id: "i1", type: "function_call", name: "note_correction", call_id: "c1" },
      }),
      1,
    );
    expect(toList(s)[0].kind === "tool" && toList(s)[0].kind).toBe("tool");

    s = transcriptReducer(
      s,
      evt({
        type: "response.function_call_arguments.done",
        call_id: "c1",
        name: "note_correction",
        arguments: '{"language":"zh","said":"三本狗","correct":"三只狗"}',
      }),
      2,
    );
    s = transcriptReducer(
      s,
      evt({ type: CLIENT_TOOL_RESULT, call_id: "c1", result: { summary: "Correction saved." }, ms: 4 }),
      3,
    );

    const item = toList(s)[0];
    expect(item.kind === "tool" && item.status).toBe("ok");
    expect(item.kind === "tool" && item.ms).toBe(4);
    expect(item.kind === "tool" && (item.args as { correct: string }).correct).toBe("三只狗");
  });

  it("marks a failed tool as an error", () => {
    let s = emptyTranscript;
    s = transcriptReducer(
      s,
      evt({
        type: "response.function_call_arguments.done",
        call_id: "c1",
        name: "note_correction",
        arguments: "{}",
      }),
      1,
    );
    s = transcriptReducer(
      s,
      evt({ type: CLIENT_TOOL_RESULT, call_id: "c1", result: { error: "tool_failed" }, ms: 1 }),
      2,
    );
    expect(toList(s)[0].kind === "tool" && toList(s)[0].kind).toBe("tool");
    const item = toList(s)[0];
    expect(item.kind === "tool" && item.status).toBe("error");
  });

  it("shows malformed arguments rather than dropping them", () => {
    let s = emptyTranscript;
    s = transcriptReducer(
      s,
      evt({
        type: "response.function_call_arguments.done",
        call_id: "c1",
        name: "note_correction",
        arguments: "{not json",
      }),
      1,
    );
    const item = toList(s)[0];
    expect(item.kind === "tool" && item.args).toBe("{not json");
  });
});

// Type-level only: these fail `tsc`/vitest typecheck if the detail contract drifts.
describe("tool detail types", () => {
  it("maps each tool name to its detail type", () => {
    expectTypeOf<ToolDetailByName["note_correction"]>().toEqualTypeOf<Correction>();
    expectTypeOf<ToolDetailByName["save_phrase"]>().toEqualTypeOf<Phrase>();
    expectTypeOf<ToolDetailByName["pronunciation_feedback"]>().toEqualTypeOf<PronunciationNote>();
    expectTypeOf<ToolDetailByName["set_practice_language"]>().toEqualTypeOf<PracticeLanguage>();
  });

  it("narrows the union on `type`", () => {
    const d: ToolDetail = { type: "phrase", language: "zh", phrase: "加油", meaning: "keep going" };
    if (d.type === "phrase") expectTypeOf(d).toEqualTypeOf<Phrase>();
    expect(d.type).toBe("phrase");
  });
});
