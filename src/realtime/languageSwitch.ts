import type { TargetLanguageCode } from "../lang/profiles";

/**
 * Spot a learner asking to practise another language, in direct mode.
 *
 * The switch normally happens when the model calls set_practice_language, but
 * Higgs Realtime often doesn't: live, "can we switch to Japanese right now?"
 * got no call, so a French tutor kept answering. RealtimeClient uses this to
 * make the switch itself. livekit/language_switch.py is the agent's copy, and
 * both are tested on the same phrases.
 */

/** Names a learner says for each target language. Typed, so a new language can't be missed. */
const LANGUAGE_NAMES: Record<TargetLanguageCode, readonly string[]> = {
  zh: ["mandarin", "chinese"],
  ko: ["korean"],
  fr: ["french"],
  ja: ["japanese"],
  sr: ["serbian"],
  vi: ["vietnamese"],
};

// A switch needs a verb aimed at the language, so "how do you say hello in
// Japanese?" doesn't count but "let's do Japanese" and "speak Japanese" do.
const VERB =
  "(?:switch(?:ed|ing)?|chang(?:e|ed|ing)|move|go|try|do|learn(?:ing)?|" +
  "practi[cs](?:e|ing)|speak(?:ing)?|teach(?:ing)?\\s+me|study(?:ing)?)";
const NAMES = Object.values(LANGUAGE_NAMES).flat().join("|");
const SWITCH = new RegExp(
  `\\b${VERB}\\b(?:\\s+\\w+ly)?(?:\\s+(?:over|on|back))?(?:\\s+(?:to|into|in|with|some))?` +
    `\\s+(?:learning\\s+|speaking\\s+)?(${NAMES})\\b`,
  "gi",
);

/** The language the learner asked to switch to, or null. Naming the current one is no switch. */
export function requestedLanguage(learnerTurn: string, current: TargetLanguageCode): TargetLanguageCode | null {
  for (const match of learnerTurn.matchAll(SWITCH)) {
    const name = match[1].toLowerCase();
    const code = (Object.keys(LANGUAGE_NAMES) as TargetLanguageCode[]).find((c) => LANGUAGE_NAMES[c].includes(name));
    if (code && code !== current) return code;
  }
  return null;
}
