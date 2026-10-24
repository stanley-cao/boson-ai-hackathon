import { describe, expect, it } from "vitest";
import { practiceLabel } from "../src/ui/PracticeBadge";
import { ACTIVE_PAIR } from "../src/lang/profiles";

describe("practice badge label", () => {
  it("defaults to the active target language with no level", () => {
    const label = practiceLabel(null);
    expect(label.language).toBe(ACTIVE_PAIR.target);
    expect(label.level).toBeNull();
  });

  it("names Mandarin in its own script", () => {
    expect(practiceLabel(null).name).toBe("中文");
  });

  it("follows the latest set_practice_language choice", () => {
    const label = practiceLabel({ type: "practice_language", language: "ko", level: "intermediate" });
    expect(label).toEqual({ language: "ko", name: "한국어", level: "intermediate" });
  });
});
