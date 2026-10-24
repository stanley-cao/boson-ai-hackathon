import { describe, expect, it } from "vitest";
import { buildSessionConfig, buildTutorPrompt, SYSTEM_PROMPT } from "../src/realtime/sessionConfig";
import { PROFILES } from "../src/lang/profiles";

describe("tutor prompt", () => {
  it("names the learner's language and the target language from the active pair", () => {
    const prompt = buildTutorPrompt();
    expect(prompt).toContain(`learner speaks ${PROFILES.en.name}`);
    expect(prompt).toContain(`learning ${PROFILES.zh.name}`);
  });

  it("asks for pinyin with tone marks in tool arguments when the target has romanization", () => {
    expect(buildTutorPrompt()).toContain("In tool arguments, write Mandarin Chinese with pinyin and tone marks.");
  });

  it("mirrors each language explicitly and never asks the learner to pick one", () => {
    // Probed 2026-10-24: "reply in the language they just used" answered
    // pure-Mandarin turns in English; naming both directions fixed it.
    const prompt = buildTutorPrompt();
    expect(prompt).toContain("When they speak Mandarin Chinese, answer in Mandarin Chinese");
    expect(prompt).toContain("never ask which language they want");
  });

  it("only asks for pinyin inside tool arguments", () => {
    // An unscoped "write with pinyin" made the tutor speak pinyin, not
    // characters, so every mention of pinyin must be the tool-argument line.
    const outsideTools = buildTutorPrompt().replace(/In tool arguments[^.]*\./, "");
    expect(outsideTools).not.toMatch(/pinyin/i);
  });

  it("omits the romanization line for a profile without one", () => {
    const prompt = buildTutorPrompt(PROFILES.en, PROFILES.en);
    expect(prompt).not.toContain("tone marks");
  });

  it("speaks each correction target clearly exactly once after its tool returns", () => {
    const prompt = buildTutorPrompt();
    expect(prompt).toContain("After note_correction returns, say its correct text clearly exactly once.");
    expect(prompt).toContain(
      "After pronunciation_feedback returns, say its target clearly exactly once.",
    );
  });

  it("stays short, because extra rules stop the model calling tools", () => {
    // A tripwire rather than a target: a prompt that grows past this is a sign
    // the model may stop calling tools.
    expect(buildTutorPrompt().length).toBeLessThanOrEqual(1200);
  });

  it("is what the session sends as instructions", () => {
    const event = buildSessionConfig();
    expect(event.type).toBe("session.update");
    // ClientEvent is a loose record, so the session payload needs a cast here.
    const session = event.session as { instructions: string };
    expect(session.instructions).toBe(SYSTEM_PROMPT);
  });
});
