import { describe, expect, it } from "vitest";
import { ACTIVE_PAIR, PROFILES } from "../src/lang/profiles";

const HAN = /\p{Script=Han}/u;

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

  it("keeps promptNotes short and gives every language openers", () => {
    // promptNotes go into the system prompt, and a long prompt stops the
    // model calling tools (see CLAUDE.md). The cap is a tripwire, not a target.
    for (const profile of Object.values(PROFILES)) {
      expect(profile.promptNotes.length, profile.code).toBeGreaterThan(0);
      expect(profile.promptNotes.length, profile.code).toBeLessThanOrEqual(300);
      expect(profile.sampleOpeners.length, profile.code).toBeGreaterThan(0);
    }
  });
});
