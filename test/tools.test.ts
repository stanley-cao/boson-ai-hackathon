import { describe, expect, expectTypeOf, it } from "vitest";
import { dispatch } from "../src/tools/registry";
import {
  noteCorrection,
  normalizeLanguage,
  setPracticeLanguage,
  pronunciationFeedback,
  savePhrase,
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

  it("returns null for values it does not know, rather than guessing", () => {
    for (const sent of ["Klingon", "", "  ", "ko", "fr-FR", "Chinese (Simplified)"]) {
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
    for (const language of ["Korean", "ko", "fr-FR", "", undefined, { code: "zh" }]) {
      const r = setPracticeLanguage({ language, level: "beginner" });
      expect(r.error, String(language)).toBe("unknown_language");
      for (const p of Object.values(PROFILES)) expect(r.summary).toContain(p.name);
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
    // An enum here pulled a request for Korean onto "en"; see definitions.ts.
    expect(def?.parameters.properties.language).not.toHaveProperty("enum");
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

  it("is offered with every profile language and the fields a card needs", () => {
    expect(TOOL_DEFINITIONS.find((d) => d.name === "pronunciation_feedback")).toMatchObject({
      parameters: {
        properties: {
          language: { enum: Object.keys(PROFILES) },
          issue: { enum: ["tone", "initial", "final", "other"] },
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
