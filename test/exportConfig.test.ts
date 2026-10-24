import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildQuizPrompts, buildSessionConfig, buildTutorPrompts } from "../src/realtime/sessionConfig";

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

  it("keeps transcription language unset for code-switched speech", () => {
    expect(exported.audio.input.transcription).not.toHaveProperty("language");
  });
});

describe("shared/quiz-prompts.json", () => {
  const prompts = JSON.parse(readFileSync(new URL("../shared/quiz-prompts.json", import.meta.url), "utf8")) as unknown;

  it("matches buildQuizPrompts() (run `npm run export-config` if not)", () => {
    expect(prompts).toEqual(buildQuizPrompts());
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
