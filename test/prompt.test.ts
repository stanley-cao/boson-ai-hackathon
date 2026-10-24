import { describe, expect, it } from "vitest";
import {
  buildInstructionsUpdate,
  buildSessionConfig,
  buildTutorPrompt,
  SYSTEM_PROMPT,
} from "../src/realtime/sessionConfig";
import { LEARNER_LEVELS, PROFILES } from "../src/lang/profiles";
import { TOOL_DEFINITIONS } from "../src/tools/definitions";

describe("tutor prompt", () => {
  it("names the learner's language and the target language from the active pair", () => {
    const prompt = buildTutorPrompt();
    expect(prompt).toContain(`learner speaks ${PROFILES.en.name}`);
    expect(prompt).toContain(`learning ${PROFILES.zh.name}`);
  });

  it("asks for pinyin with tone marks in tool arguments when the target has romanization", () => {
    expect(buildTutorPrompt()).toContain("use pinyin romanization with tone marks");
  });

  it("builds target-specific prompts and session configs for every selectable language", () => {
    expect(buildTutorPrompt(PROFILES.ko)).toContain("learning Korean");
    expect(buildTutorPrompt(PROFILES.ko)).toContain("revised romanization");
    expect(buildTutorPrompt(PROFILES.fr)).not.toContain("romanization");
    expect(buildTutorPrompt(PROFILES.ja)).toContain("hepburn romanization");

    const korean = buildSessionConfig(LEARNER_LEVELS.beginner, PROFILES.ko).session as {
      instructions: string;
    };
    expect(korean.instructions).toContain("learning Korean");

    const refreshed = buildInstructionsUpdate("intermediate", "slow", "ja").session as {
      instructions: string;
    };
    expect(refreshed.instructions).toContain("learning Japanese");
    expect(refreshed.instructions).toContain("Speak very slowly");
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

  it("keeps replies short and expressive for the on-screen tutor", () => {
    const prompt = buildTutorPrompt();
    expect(prompt).toContain("one or two short sentences, said warmly and expressively");
  });

  it("leaves per-tool guidance to the tool descriptions", () => {
    // The "say it clearly exactly once" rule (#22) moved into note_correction's
    // and pronunciation_feedback's descriptions (#80); tools.test.ts checks it.
    const prompt = buildTutorPrompt();
    expect(prompt).not.toContain("note_correction");
    expect(prompt).not.toContain("pronunciation_feedback");
  });

  it("gives beginners slower speech and more English support than intermediates", () => {
    const beginner = buildTutorPrompt(PROFILES.zh, PROFILES.en, LEARNER_LEVELS.beginner);
    const intermediate = buildTutorPrompt(PROFILES.zh, PROFILES.en, LEARNER_LEVELS.intermediate);

    expect(beginner).toContain("Speak slowly");
    expect(beginner).toContain("what it means in English");
    expect(intermediate).toContain("natural but clear pace");
    expect(intermediate).toContain("mostly the target language");
    expect(intermediate).not.toContain("what it means in English");
  });

  it("leaves slow requests to set_speaking_pace rather than a prompt rule", () => {
    // #76: the rule didn't change the pace; re-instructing the session does.
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "set_speaking_pace");
    expect(tool?.description).toContain("say that again slowly");
    expect(tool?.description).toContain("please speak more slowly");
    expect(buildTutorPrompt()).not.toContain("say that again slowly");
  });

  it("can build a session for either learner level", () => {
    const beginner = buildSessionConfig(LEARNER_LEVELS.beginner).session as {
      instructions: string;
    };
    const intermediate = buildSessionConfig(LEARNER_LEVELS.intermediate).session as {
      instructions: string;
    };
    expect(beginner.instructions).toContain("Learner level: beginner");
    expect(intermediate.instructions).toContain("Learner level: intermediate");
  });

  it("stays short, because extra rules stop the model calling tools", () => {
    // A tripwire rather than a target: a prompt that grows past this is a sign
    // the model may stop calling tools. Checked per level because the
    // intermediate note is the longer one, and the default is beginner.
    for (const level of Object.values(LEARNER_LEVELS)) {
      for (const target of Object.values(PROFILES)) {
        const prompt = buildTutorPrompt(target, PROFILES.en, level);
        expect(prompt.length, `${target.code} ${level.code}`).toBeLessThanOrEqual(1200);
      }
    }
  });

  it("is what the session sends as instructions", () => {
    const event = buildSessionConfig();
    expect(event.type).toBe("session.update");
    // ClientEvent is a loose record, so the session payload needs a cast here.
    const session = event.session as { instructions: string };
    expect(session.instructions).toBe(SYSTEM_PROMPT);
  });
});
