import { describe, expect, it } from "vitest";
import { learnerLevelFor } from "../src/lang/profiles";
import {
  buildInstructionsUpdate,
  buildSessionConfig,
  practiceChangeFromTool,
} from "../src/realtime/sessionConfig";
import { setPracticeLanguage } from "../src/tools/handlers";

// #77: the level the learner states has to reach the session's instructions.

describe("learnerLevelFor", () => {
  it("picks the stored level's profile", () => {
    expect(learnerLevelFor("beginner")).toBe("beginner");
    expect(learnerLevelFor("intermediate")).toBe("intermediate");
  });

  it("maps advanced to the intermediate profile", () => {
    expect(learnerLevelFor("advanced")).toBe("intermediate");
  });

  it("falls back to beginner with no stored level or an unknown one", () => {
    expect(learnerLevelFor(undefined)).toBe("beginner");
    expect(learnerLevelFor(null)).toBe("beginner");
    expect(learnerLevelFor("expert")).toBe("beginner");
  });
});

describe("buildInstructionsUpdate for a level", () => {
  it("sends only the new level's instructions", () => {
    const event = buildInstructionsUpdate("intermediate", "normal");
    expect(event.type).toBe("session.update");
    const session = event.session as Record<string, unknown>;
    expect(Object.keys(session)).toEqual(["instructions"]);
    expect(session.instructions).toContain("Learner level: intermediate");
  });

  it("matches the instructions a fresh session at that level would get", () => {
    const fresh = buildSessionConfig().session as { instructions: string };
    const update = buildInstructionsUpdate("beginner", "normal").session as { instructions: string };
    expect(update.instructions).toBe(fresh.instructions);
  });
});

describe("practiceChangeFromTool", () => {
  const practise = (level: string, language = "zh") => setPracticeLanguage({ language, level });
  const zhBeginner = { target: "zh", level: "beginner" } as const;

  it("reports a new level from set_practice_language", () => {
    expect(practiceChangeFromTool("set_practice_language", practise("intermediate"), zhBeginner)).toEqual(
      { target: "zh", level: "intermediate" },
    );
    expect(practiceChangeFromTool("set_practice_language", practise("advanced"), zhBeginner)).toEqual({
      target: "zh",
      level: "intermediate",
    });
  });

  it("reports a new language mid-session, keeping the level it was given", () => {
    const fromSerbian = { target: "sr", level: "beginner" } as const;
    expect(
      practiceChangeFromTool("set_practice_language", practise("beginner", "French"), fromSerbian),
    ).toEqual({ target: "fr", level: "beginner" });
  });

  it("ignores a language and level whose prompt is already active", () => {
    expect(practiceChangeFromTool("set_practice_language", practise("beginner"), zhBeginner)).toBeNull();
    expect(
      practiceChangeFromTool("set_practice_language", practise("advanced"), {
        target: "zh",
        level: "intermediate",
      }),
    ).toBeNull();
  });

  it("ignores other tools, errors and malformed results", () => {
    const failed = setPracticeLanguage({ language: "klingon", level: "intermediate" });
    expect(practiceChangeFromTool("set_practice_language", failed, zhBeginner)).toBeNull();
    expect(practiceChangeFromTool("save_phrase", practise("intermediate"), zhBeginner)).toBeNull();
    expect(practiceChangeFromTool("set_practice_language", null, zhBeginner)).toBeNull();
    expect(practiceChangeFromTool("set_practice_language", { detail: "x" }, zhBeginner)).toBeNull();
  });
});
