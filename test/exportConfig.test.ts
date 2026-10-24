import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSessionConfig,
  buildTutorPrompt,
  buildTutorPrompts,
  SLOW_PACE_NOTE,
} from "../src/realtime/sessionConfig";
import { LEARNER_LEVELS, PROFILES } from "../src/lang/profiles";

// The LiveKit agent reads this file instead of the TypeScript, so a stale copy
// silently runs an old prompt or tool list there (#30).
const exported = JSON.parse(
  readFileSync(new URL("../shared/session.json", import.meta.url), "utf8"),
) as { instructions: string; tools: { name: string }[]; audio: { input: { transcription: object } } };

describe("shared/session.json", () => {
  it("matches buildSessionConfig() (run `npm run export-config` if not)", () => {
    expect(exported).toEqual(buildSessionConfig().session);
  });

  it("carries the prompt and every tool", () => {
    expect(exported.instructions.length).toBeGreaterThan(0);
    expect(exported.tools.map((tool) => tool.name)).toContain("note_correction");
  });

  it("carries the native-language transcription hint", () => {
    expect(exported.audio.input.transcription).toMatchObject({ language: "en" });
  });
});

describe("shared/prompts.json", () => {
  const prompts = JSON.parse(readFileSync(new URL("../shared/prompts.json", import.meta.url), "utf8")) as unknown;

  it("matches buildTutorPrompts() (run `npm run export-config` if not)", () => {
    expect(prompts).toEqual(buildTutorPrompts());
  });

  it("has the default prompt at the default pair and level", () => {
    expect((prompts as Record<string, Record<string, string>>).zh.beginner).toBe(exported.instructions);
  });
});

describe("shared/pace.json", () => {
  const pace = JSON.parse(readFileSync(new URL("../shared/pace.json", import.meta.url), "utf8")) as {
    slow_note: string;
  };

  it("carries the slow-pace sentence (run `npm run export-config` if not)", () => {
    expect(pace.slow_note).toBe(SLOW_PACE_NOTE);
  });

  it("is what a slow prompt appends, as the agent builds it", () => {
    // livekit/agent.py builds the slow prompt as `prompt + " " + slow_note`.
    const args = [PROFILES.sr, PROFILES.en, LEARNER_LEVELS.beginner] as const;
    expect(buildTutorPrompt(...args, "slow")).toBe(`${buildTutorPrompt(...args, "normal")} ${pace.slow_note}`);
  });
});
