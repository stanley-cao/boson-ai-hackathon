import { describe, expect, it } from "vitest";
import {
  buildInstructionsUpdate,
  buildTutorPrompt,
  planPaceChange,
  SLOW_PACE_NOTE,
  SYSTEM_PROMPT,
} from "../src/realtime/sessionConfig";
import { paceRequestFrom, setSpeakingPace, SLOW_REPEAT_PLAYING } from "../src/tools/handlers";
import { estimateSyllables, paceMsPerSyllable, slowSpeechInput } from "../src/realtime/pace";

// #76: a slow request has to change the instructions, not just be a rule.

describe("paceRequestFrom", () => {
  it("reads a slow repeat and a lasting slow-down", () => {
    expect(paceRequestFrom({ pace: "slow", scope: "once" })).toEqual({ pace: "slow", scope: "once" });
    expect(paceRequestFrom({ pace: "Slow", scope: "session" })).toEqual({ pace: "slow", scope: "session" });
  });

  it("applies normal pace to the session whatever the scope", () => {
    expect(paceRequestFrom({ pace: "normal", scope: "once" })).toEqual({ pace: "normal", scope: "session" });
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
    expect(planPaceChange({ pace: "slow", scope: "once" }, "slow").send).toBeNull();
    expect(planPaceChange({ pace: "slow", scope: "once" }, "slow").revertAfterReply).toBe(false);
    expect(planPaceChange({ pace: "normal", scope: "session" }, "normal").send).toBeNull();
  });
});

describe("slow-pace instructions", () => {
  it("adds the slow note only at slow pace", () => {
    expect(SYSTEM_PROMPT).not.toContain(SLOW_PACE_NOTE);
    expect(buildTutorPrompt(undefined, undefined, undefined, "slow")).toContain(SLOW_PACE_NOTE);
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
  it("slows the line and pauses between words, Mandarin included", () => {
    const input = slowSpeechInput("我今天想去图书馆学习。")!;
    expect(input.startsWith("<|prosody:speed_slow|>")).toBe(true);
    expect(input).toContain("今天 <|prosody:pause|> ");
    expect(input.endsWith("学习。")).toBe(true);
    expect(input.replace(/<\|[^|]+\|>|\s/g, "")).toBe("我今天想去图书馆学习。");
  });

  it("keeps punctuation as the pause between sentences", () => {
    expect(slowSpeechInput("Hi. Good morning!")).toBe(
      "<|prosody:speed_slow|>Hi. Good <|prosody:pause|> morning!",
    );
  });

  it("drops the word pauses when the line would pass the 500-character route cap", () => {
    const long = "word ".repeat(60).trim() + ".";
    const input = slowSpeechInput(long)!;
    expect(input).not.toContain("<|prosody:pause|>");
    expect(Array.from(input).length).toBeLessThanOrEqual(500);
  });

  it("is null with nothing to say or a line too long either way", () => {
    expect(slowSpeechInput("!?")).toBeNull();
    expect(slowSpeechInput("word ".repeat(200))).toBeNull();
  });
});

describe("SLOW_REPEAT_PLAYING", () => {
  it("tells the model to stay quiet while the repeat plays", () => {
    expect(SLOW_REPEAT_PLAYING.summary).toContain("Say nothing");
    expect(SLOW_REPEAT_PLAYING.detail).toBeUndefined();
  });
});
