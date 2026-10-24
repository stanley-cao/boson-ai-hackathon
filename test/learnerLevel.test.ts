import { describe, expect, it } from "vitest";
import { learnerLevelFor } from "../src/lang/profiles";
import {
  buildInstructionsUpdate,
  buildSessionConfig,
  levelChangeFromTool,
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

describe("levelChangeFromTool", () => {
  const practise = (level: string) => setPracticeLanguage({ language: "zh", level });

  it("reports a new level from set_practice_language", () => {
    expect(levelChangeFromTool("set_practice_language", practise("intermediate"), "beginner")).toBe(
      "intermediate",
    );
    expect(levelChangeFromTool("set_practice_language", practise("advanced"), "beginner")).toBe(
      "intermediate",
    );
  });

  it("ignores a level whose profile is already active", () => {
    expect(levelChangeFromTool("set_practice_language", practise("beginner"), "beginner")).toBeNull();
    expect(
      levelChangeFromTool("set_practice_language", practise("advanced"), "intermediate"),
    ).toBeNull();
  });

  it("ignores other tools, errors and malformed results", () => {
    const failed = setPracticeLanguage({ language: "klingon", level: "intermediate" });
    expect(levelChangeFromTool("set_practice_language", failed, "beginner")).toBeNull();
    expect(levelChangeFromTool("save_phrase", practise("intermediate"), "beginner")).toBeNull();
    expect(levelChangeFromTool("set_practice_language", null, "beginner")).toBeNull();
    expect(levelChangeFromTool("set_practice_language", { detail: "x" }, "beginner")).toBeNull();
  });
});
