import type { TargetLanguageCode } from "../lang/profiles";
import { targetLanguageNames } from "../tools/handlers";

/**
 * Spot a learner asking in English to practise another language, in direct mode.
 *
 * The switch normally happens when the model calls set_practice_language, but
 * Higgs Realtime often doesn't: live, "can we switch to Japanese right now?"
 * got no call, so a French tutor kept answering. RealtimeClient uses this to
 * make the switch itself.
 *
 * This is the English half of livekit/language_switch.py, with the same names
 * (targetLanguageNames, which export-config writes to shared/languages.json),
 * patterns and false-alarm guards, tested on the same phrases. The agent also
 * reads requests made in the languages taught ("parlons japonais"); those
 * patterns rely on Python's Unicode \w and \b, so voice-only mode leaves them
 * to the model's own tool call.
 */

// Python's \b and \w are Unicode; JavaScript's aren't, even with the u flag.
const W = "[\\p{L}\\p{M}\\p{N}_]";
const B_START = `(?<!${W})`;
const B_END = `(?!${W})`;

const CODE_FOR = new Map<string, TargetLanguageCode>(
  (Object.entries(targetLanguageNames()) as [TargetLanguageCode, string[]][]).flatMap(([code, names]) =>
    names.map((name) => [name.toLowerCase(), code] as const),
  ),
);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Longest first, so a longer name wins over a shorter one inside it.
const NAME = `(${[...CODE_FOR.keys()].sort((a, b) => b.length - a.length).map(escape).join("|")})${B_END}`;

// A switch needs a verb aimed at the language, so "how do you say hello in
// Japanese?" doesn't count but "let's do Japanese" and "speak Japanese" do.
const VERB =
  "(?:switch(?:ed|ing)?|chang(?:e|ed|ing)|move|go|try|do|learn(?:ing)?|" +
  "practi[cs](?:e|ing)|speak(?:ing)?|teach(?:ing)?\\s+me|study(?:ing)?)";
const PATTERNS = [
  // "switch to Japanese", "change the language to Korean", "go back to French".
  `${B_START}${VERB}${B_END}(?:\\s+${W}+ly)?(?:\\s+(?:the\\s+)?(?:language|lesson|it|this|us))?` +
    `(?:\\s+(?:over|on|back))?(?:\\s+(?:to|into|in|with|some))?\\s+(?:learning\\s+|speaking\\s+)?${NAME}`,
  `${B_START}(?:how|what)\\s+about\\s+(?:some\\s+)?${NAME}`,
  `${B_START}(?:i\\s+want|i'?d\\s+like|i\\s+would\\s+like|i'?d\\s+rather)\\s+(?:to\\s+do\\s+|some\\s+)?${NAME}`,
  // "talk to me in Japanese", "can we do this in Korean?". Not "say … in":
  // "can you say that in Japanese?" asks for a translation.
  `${B_START}(?:talk|speak|reply|answer|respond|chat|continue|do\\s+(?:this|it|that))` +
    `(?:\\s+(?:to|with)\\s+me)?\\s+in\\s+${NAME}`,
  // The whole turn is the language: "Japanese please", "Korean!".
  `^[^\\p{L}\\p{N}]*${NAME}(?:\\s+(?:please|now|instead))*[^\\p{L}\\p{N}]*$`,
].map((source) => new RegExp(source, "giu"));

// A negation just before the request: "I don't want to switch to Japanese".
// A comma ends its reach, so "no worries, let's do Japanese" still switches.
const NEGATED = new RegExp(
  `${B_START}(?:don'?t|do\\s+not|doesn'?t|(?<!why\\s)not|never|won'?t|wouldn'?t|can'?t|cannot|no\\s+more)` +
    `\\s+(?:${W}+\\s+){0,3}$`,
  "iu",
);
// "I'm studying Japanese at school" reports a fact; it isn't a request. The
// subject comes before the match, the -ing verb starts it.
const STATEMENT_SUBJECT = new RegExp(
  `${B_START}(?:i'?m|i\\s+am|i\\s+was|i'?ve\\s+been|we'?re|we\\s+are|they'?re|he'?s|she'?s)\\s+(?:${W}+ly\\s+|also\\s+)?$`,
  "iu",
);
const STATEMENT_VERB = /^(?:learning|studying|practi[cs]ing|speaking)/iu;

/** The language the learner asked to switch to, or null. Naming the current one is no switch. */
export function requestedLanguage(learnerTurn: string, current: TargetLanguageCode): TargetLanguageCode | null {
  for (const pattern of PATTERNS) {
    for (const match of learnerTurn.matchAll(pattern)) {
      const before = learnerTurn.slice(0, match.index);
      if (NEGATED.test(before)) continue;
      if (STATEMENT_SUBJECT.test(before) && STATEMENT_VERB.test(match[0])) continue;
      const code = CODE_FOR.get(match[1].toLowerCase());
      if (code && code !== current) return code;
    }
  }
  return null;
}
