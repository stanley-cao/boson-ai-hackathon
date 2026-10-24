import { describe, expect, it } from "vitest";
import { requestedLanguage } from "../src/realtime/languageSwitch";

// The same phrases as livekit/test_language_switch.py, so both modes agree.
describe("requestedLanguage", () => {
  it.each([
    // Said live in a French session, where the model called no tool.
    "Uh, so can we switch to Japanese right now?",
    "I know, no, I can be switched to learning Japanese.",
    "Switch properly to Japanese, please.",
    "Speak Japanese.",
    "Let's do Japanese instead.",
    "Can we practise Japanese?",
  ])("hears a switch in %j", (turn) => {
    expect(requestedLanguage(turn, "fr")).toBe("ja");
  });

  it.each([
    // Asking about a word isn't asking to switch.
    "How do you say hello in Japanese?",
    "So, can you give me the translation of How are you in Japanese?",
    // Nor is naming the language already being taught.
    "I want to learn some French today.",
    "",
  ])("hears no switch in %j", (turn) => {
    expect(requestedLanguage(turn, "fr")).toBeNull();
  });

  it("knows every target language", () => {
    expect(requestedLanguage("switch to Mandarin", "fr")).toBe("zh");
    expect(requestedLanguage("let's learn Chinese", "fr")).toBe("zh");
    expect(requestedLanguage("change to Korean", "fr")).toBe("ko");
    expect(requestedLanguage("practice Serbian", "fr")).toBe("sr");
    expect(requestedLanguage("let's do Vietnamese", "fr")).toBe("vi");
    expect(requestedLanguage("go back to French", "ja")).toBe("fr");
  });
});
