import { describe, expect, it } from "vitest";
import {
  buildInstructionsUpdate,
  buildTutorPrompt,
  planPaceChange,
  SLOW_PACE_NOTE,
  SLOWER_PACE_NOTE,
  SYSTEM_PROMPT,
} from "../src/realtime/sessionConfig";
import {
  oneOffPace,
  paceRequestFrom,
  setSpeakingPace,
  slowRepeatSummary,
  SLOW_REPEAT_PLAYING,
} from "../src/tools/handlers";
import {
  estimateSyllables,
  paceMsPerSyllable,
  practiceFocusFromTool,
  slowSpeechChunks,
  slowSpeechInput,
} from "../src/realtime/pace";

// #76: a slow request has to change the instructions, not just be a rule.

describe("paceRequestFrom", () => {
  it("reads a slow repeat and a lasting slow-down", () => {
    expect(paceRequestFrom({ pace: "slow", scope: "once" })).toEqual({ pace: "slow", scope: "once" });
    expect(paceRequestFrom({ pace: "Slow", scope: "session" })).toEqual({ pace: "slow", scope: "session" });
  });

  it("applies normal pace to the session whatever the scope", () => {
    expect(paceRequestFrom({ pace: "normal", scope: "once" })).toEqual({ pace: "normal", scope: "session" });
  });

  it("reads even slower as slower", () => {
    for (const pace of ["slower", "very slow", "Even slower", "slowest"]) {
      expect(paceRequestFrom({ pace, scope: "session" }).pace, pace).toBe("slower");
    }
  });

  it("treats missing or unknown arguments as a one-off slow repeat", () => {
    expect(paceRequestFrom({})).toEqual({ pace: "slow", scope: "once" });
    expect(paceRequestFrom({ pace: 3, scope: "sometimes" })).toEqual({ pace: "slow", scope: "once" });
  });
});

describe("setSpeakingPace", () => {
  it("asks for the same content again on a slow repeat, with no study detail", () => {
    const result = setSpeakingPace({ pace: "slow", scope: "once" });
    expect(result.summary).toContain("repeat the content of your previous reply");
    expect(result.detail).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("says a lasting slower pace as very slowly", () => {
    expect(setSpeakingPace({ pace: "slower", scope: "session" }).summary).toContain("very slowly");
  });
});

describe("slowRepeatSummary", () => {
  it("names the study item when there is one, else the previous reply", () => {
    expect(slowRepeatSummary("谢谢")).toContain("say 谢谢 again, slowly");
    expect(slowRepeatSummary(null)).toContain("repeat the content of your previous reply");
  });
});

describe("oneOffPace", () => {
  it("is slow after normal speech, and a step slower after slow speech", () => {
    expect(oneOffPace("slow", "normal")).toBe("slow");
    expect(oneOffPace("slow", "slow")).toBe("slower");
    expect(oneOffPace("slow", "slower")).toBe("slower");
    expect(oneOffPace("slower", "normal")).toBe("slower");
  });
});

describe("planPaceChange", () => {
  it("sends a slow repeat and reverts after it", () => {
    expect(planPaceChange({ pace: "slow", scope: "once" }, "normal")).toEqual({
      send: "slow",
      revertAfterReply: true,
      sessionPace: "normal",
    });
  });

  it("keeps a session slow-down", () => {
    expect(planPaceChange({ pace: "slow", scope: "session" }, "normal")).toEqual({
      send: "slow",
      revertAfterReply: false,
      sessionPace: "slow",
    });
  });

  it("sends nothing when the pace is already right", () => {
    expect(planPaceChange({ pace: "slower", scope: "once" }, "slower").send).toBeNull();
    expect(planPaceChange({ pace: "slow", scope: "once" }, "slower").revertAfterReply).toBe(false);
    expect(planPaceChange({ pace: "normal", scope: "session" }, "normal").send).toBeNull();
  });

  it("steps down to slower when asked for slow while already slow", () => {
    expect(planPaceChange({ pace: "slow", scope: "session" }, "slow")).toEqual({
      send: "slower",
      revertAfterReply: false,
      sessionPace: "slower",
    });
    expect(planPaceChange({ pace: "slow", scope: "once" }, "slow")).toEqual({
      send: "slower",
      revertAfterReply: true,
      sessionPace: "slow",
    });
    // Straight after a one-off slow repeat at normal session pace.
    expect(planPaceChange({ pace: "slow", scope: "once" }, "normal", "slow").send).toBe("slower");
  });

  it("goes back to normal from slower in one step", () => {
    expect(planPaceChange({ pace: "normal", scope: "session" }, "slower")).toEqual({
      send: "normal",
      revertAfterReply: false,
      sessionPace: "normal",
    });
  });
});

describe("slow-pace instructions", () => {
  it("adds the slow note only at slow pace", () => {
    expect(SYSTEM_PROMPT).not.toContain(SLOW_PACE_NOTE);
    expect(buildTutorPrompt(undefined, undefined, undefined, "slow")).toContain(SLOW_PACE_NOTE);
    const slower = buildTutorPrompt(undefined, undefined, undefined, "slower");
    expect(slower).toContain(SLOWER_PACE_NOTE);
    expect(slower).not.toContain(SLOW_PACE_NOTE);
  });

  it("no longer asks the tutor to match the learner's energy", () => {
    expect(SYSTEM_PROMPT).not.toContain("energy");
  });

  it("stays under the length tripwire when slow", () => {
    expect(buildTutorPrompt(undefined, undefined, undefined, "slow").length).toBeLessThanOrEqual(1200);
  });

  it("keeps the level when the pace changes", () => {
    const update = buildInstructionsUpdate("intermediate", "slow").session as { instructions: string };
    expect(update.instructions).toContain("Learner level: intermediate");
    expect(update.instructions).toContain(SLOW_PACE_NOTE);
  });

  it("updates only the instructions", () => {
    const event = buildInstructionsUpdate("beginner", "slow");
    expect(event.type).toBe("session.update");
    const session = event.session as Record<string, unknown>;
    expect(Object.keys(session)).toEqual(["instructions"]);
    expect(session.instructions).toContain(SLOW_PACE_NOTE);
    expect((buildInstructionsUpdate("beginner", "normal").session as { instructions: string }).instructions).toBe(SYSTEM_PROMPT);
  });
});

describe("pace measure", () => {
  it("counts a Han character as one syllable and Latin words by vowel groups", () => {
    expect(estimateSyllables("我今天想去图书馆学习。")).toBe(10);
    expect(estimateSyllables("I want to study today")).toBe(7);
    expect(estimateSyllables("make")).toBe(1);
  });

  it("gives ms of audio per syllable", () => {
    // 24000 samples = 1 s over 4 syllables.
    expect(paceMsPerSyllable(24000, "你好你好")).toBe(250);
  });

  it("is null with no speech or no audio", () => {
    expect(paceMsPerSyllable(24000, "。!")).toBeNull();
    expect(paceMsPerSyllable(0, "你好")).toBeNull();
  });
});

describe("slowSpeechInput", () => {
  it("slows the line and stops after every Mandarin syllable", () => {
    expect(slowSpeechInput("我今天想去图书馆学习。")).toBe(
      "<|prosody:speed_slow|>我。今。天。想。去。图。书。馆。学。习。",
    );
  });

  it("splits pinyin words but leaves English whole", () => {
    const input = slowSpeechInput('你好 (nǐ hǎo) means "hello".')!;
    expect(input).toBe('<|prosody:speed_slow|>你。好。 (nǐ. hǎo.) means "hello".');
  });

  it("adds no stop where punctuation already is one", () => {
    expect(slowSpeechInput("你好！再见。")).toBe("<|prosody:speed_slow|>你。好！再。见。");
  });

  it("uses the very slow tag for slower", () => {
    expect(slowSpeechInput("你好", { pace: "slower" })).toBe("<|prosody:speed_very_slow|>你。好");
  });

  it("splits Korean per syllable", () => {
    expect(slowSpeechInput("감사합니다.", { language: "ko" })).toBe("<|prosody:speed_slow|>감。사。합。니。다.");
  });

  it("splits Japanese by word, not by kanji", () => {
    const input = slowSpeechInput("今日は図書館で勉強したいです。", { language: "ja" })!;
    // 今日 (kyō) and 図書館 stay whole; a stop per character would read 今 and 日 apart.
    expect(input).toContain("今日。");
    expect(input).toContain("図書館。");
    expect(input).not.toContain("今。日");
    expect(input.endsWith("です。")).toBe(true);
  });

  it("splits every word of a line wholly in a Latin-script target", () => {
    expect(slowSpeechInput("Je voudrais un café, s'il vous plaît.", { language: "fr", wholeTarget: true })).toBe(
      "<|prosody:speed_slow|>Je. voudrais. un. café, s'il. vous. plaît.",
    );
    expect(slowSpeechInput("Việt Nam", { language: "vi", wholeTarget: true })).toBe(
      "<|prosody:speed_slow|>Việt. Nam.",
    );
  });

  it("leaves a mixed Latin-script reply whole, and doesn't read Vietnamese as pinyin", () => {
    const line = "Café means coffee.";
    expect(slowSpeechInput(line, { language: "fr" })).toBe(`<|prosody:speed_slow|>${line}`);
    expect(slowSpeechInput("Cà phê means coffee.", { language: "vi" })).toBe(
      "<|prosody:speed_slow|>Cà phê means coffee.",
    );
  });

  it("is null with nothing to say or a line too long for the route", () => {
    expect(slowSpeechInput("!?")).toBeNull();
    expect(slowSpeechInput("好".repeat(300))).toBeNull();
  });
});

describe("slowSpeechChunks", () => {
  it("is one part for a line that fits", () => {
    expect(slowSpeechChunks("你好")).toEqual(["<|prosody:speed_slow|>你。好"]);
  });

  it("says a long line in parts that each fit the route, broken at stops", () => {
    const parts = slowSpeechChunks("好".repeat(300))!;
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(Array.from(part).length).toBeLessThanOrEqual(500);
      expect(part.startsWith("<|prosody:speed_slow|>")).toBe(true);
      // Never a dangling half: each part ends on a syllable's stop or the line's end.
      expect(part.endsWith("。") || part.endsWith("好")).toBe(true);
    }
    // Nothing lost: every syllable is in some part.
    expect(parts.join("").match(/好/g)).toHaveLength(300);
  });

  it("breaks English at spaces, never inside a word", () => {
    const words = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const parts = slowSpeechChunks(words)!;
    expect(parts.length).toBeGreaterThan(1);
    const said = parts.map((p) => p.replace("<|prosody:speed_slow|>", "")).join(" ");
    expect(said.split(/\s+/)).toEqual(words.split(" "));
  });

  it("is null with nothing to say", () => {
    expect(slowSpeechChunks("!?")).toBeNull();
  });
});

describe("practiceFocusFromTool", () => {
  it("picks the line each study tool's reply is about", () => {
    const correction = { detail: { type: "correction", language: "ko", said: "저는 학생예요", correct: "저는 학생이에요" } };
    expect(practiceFocusFromTool(correction)).toEqual({ text: "저는 학생이에요", language: "ko" });
    expect(practiceFocusFromTool({ detail: { type: "phrase", language: "fr", phrase: " merci " } })).toEqual({
      text: "merci",
      language: "fr",
    });
    expect(practiceFocusFromTool({ detail: { type: "pronunciation", language: "zh", target: "妈" } })).toEqual({
      text: "妈",
      language: "zh",
    });
  });

  it("is null for other results, malformed ones, and English", () => {
    expect(practiceFocusFromTool({ summary: "ok" })).toBeNull();
    expect(practiceFocusFromTool({ detail: { type: "practice_language", language: "fr" } })).toBeNull();
    expect(practiceFocusFromTool({ detail: { type: "phrase", language: "en", phrase: "hi" } })).toBeNull();
    expect(practiceFocusFromTool({ detail: { type: "phrase", language: "fr", phrase: 3 } })).toBeNull();
    expect(practiceFocusFromTool(null)).toBeNull();
  });
});

describe("SLOW_REPEAT_PLAYING", () => {
  it("tells the model to stay quiet while the repeat plays", () => {
    expect(SLOW_REPEAT_PLAYING.summary).toContain("Say nothing");
    expect(SLOW_REPEAT_PLAYING.detail).toBeUndefined();
  });
});
