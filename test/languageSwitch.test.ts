import { describe, expect, it } from "vitest";
import { requestedLanguage } from "../src/realtime/languageSwitch";

// The English cases of livekit/test_language_switch.py, so both modes agree.
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

  it("knows every target language by its shared names", () => {
    expect(requestedLanguage("switch to Mandarin", "fr")).toBe("zh");
    expect(requestedLanguage("let's learn Chinese", "fr")).toBe("zh");
    expect(requestedLanguage("change to Korean", "fr")).toBe("ko");
    expect(requestedLanguage("practice Serbian", "fr")).toBe("sr");
    expect(requestedLanguage("let's do Vietnamese", "fr")).toBe("vi");
    expect(requestedLanguage("go back to French", "ja")).toBe("fr");
    expect(requestedLanguage("let's do German", "fr")).toBe("de");
    expect(requestedLanguage("practice Haitian Creole", "fr")).toBe("ht");
    expect(requestedLanguage("switch to Māori", "fr")).toBe("mi");
    expect(requestedLanguage("can we speak Farsi?", "fr")).toBe("fa");
  });

  it("doesn't read language codes as names", () => {
    // "it" and "no" are Italian's and Norwegian's codes, and ordinary words.
    expect(requestedLanguage("let's do it", "fr")).toBeNull();
    expect(requestedLanguage("I want no more", "fr")).toBeNull();
  });

  it.each([
    ["How about Japanese?", "ja"],
    ["Japanese please", "ja"],
    ["I want Korean", "ko"],
    ["I'd rather learn Vietnamese", "vi"],
    ["Talk to me in Japanese", "ja"],
    ["Can we do this in Korean?", "ko"],
    ["Change the language to Korean", "ko"],
    ["Teach me some Mandarin", "zh"],
    ["Why not switch to Japanese?", "ja"],
    ["Switch to Japanese, not Korean", "ja"],
  ])("hears %j as %s", (turn, code) => {
    expect(requestedLanguage(turn, "fr")).toBe(code);
  });

  it.each([
    // The client forces a switch, so these must not count.
    "I don't want to switch to Japanese",
    "Let's not do Korean today",
    "I'm studying Japanese at school too",
    "I'm also learning Korean with my friend",
    "My friend speaks Korean",
    "Can you say that in Japanese?",
    "What's the difference between Chinese and Japanese?",
  ])("hears no switch in the remark %j", (turn) => {
    expect(requestedLanguage(turn, "fr")).toBeNull();
  });
});
