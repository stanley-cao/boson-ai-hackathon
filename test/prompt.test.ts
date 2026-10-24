import { describe, expect, it } from "vitest";
import { buildSessionConfig, buildTutorPrompt, SYSTEM_PROMPT } from "../src/realtime/sessionConfig";
import { LEARNER_LEVELS, PROFILES } from "../src/lang/profiles";

describe("tutor prompt", () => {
  it("names the learner's language and the target language from the active pair", () => {
    const prompt = buildTutorPrompt();
    expect(prompt).toContain(`learner speaks ${PROFILES.en.name}`);
    expect(prompt).toContain(`learning ${PROFILES.zh.name}`);
  });

  it("asks for pinyin with tone marks in tool arguments when the target has romanization", () => {
    expect(buildTutorPrompt()).toContain("In tool arguments, write Mandarin Chinese with pinyin and tone marks.");
  });

  it("omits the romanization line for a profile without one", () => {
    const prompt = buildTutorPrompt(PROFILES.en, PROFILES.en);
    expect(prompt).not.toContain("tone marks");
  });

  it("gives beginners slower speech and more English support than intermediates", () => {
    const beginner = buildTutorPrompt(PROFILES.zh, PROFILES.en, LEARNER_LEVELS.beginner);
    const intermediate = buildTutorPrompt(PROFILES.zh, PROFILES.en, LEARNER_LEVELS.intermediate);

    expect(beginner).toContain("Speak slowly");
    expect(beginner).toContain("brief English scaffolding");
    expect(intermediate).toContain("natural but clear pace");
    expect(intermediate).toContain("mostly the target language");
    expect(intermediate).not.toContain("English scaffolding");
  });

  it("honours requests to repeat the same content slowly", () => {
    for (const level of Object.values(LEARNER_LEVELS)) {
      const prompt = buildTutorPrompt(PROFILES.zh, PROFILES.en, level);
      expect(prompt).toContain('says "say that again slowly"');
      expect(prompt).toContain("repeat the same content at a noticeably slower pace");
      expect(prompt).toContain("do not add new material");
    }
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
