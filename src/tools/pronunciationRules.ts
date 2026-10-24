import type { ProfileCode } from "../lang/profiles";
import type { PronunciationIssue } from "./types";

// Tip checks for the languages without tones. There are no tone marks to read
// a contour from, but each has rules a tip can break: where stress falls,
// whether there is stress at all, and (in Korean and Serbian) consonant
// classes the spelling itself shows. As with tones (#55), the rule goes in
// the summary the tutor speaks from, and a tip that contradicts it is
// replaced rather than shown on the card.

// From a negation to the end of its clause. Probed live, a correct first-tone
// tip ended "try saying it without dipping or rising".
export const NEGATED_CLAUSE = /\b(without|not|no|never|don't|do not|avoid|instead of|rather than)\b[^.,;:!?]*/g;

/** The tip with negated clauses removed, lowercased, for matching what it asks for. */
function asserted(tip: string): string {
  return tip.toLowerCase().replace(/’/g, "'").replace(NEGATED_CLAUSE, "");
}

/** What a tip check found: the rule to state, and a replacement tip if the model's broke it. */
export interface TipCheck {
  /** A clause for the summary, e.g. "French stress falls on the last syllable". */
  fact: string;
  /** Set when the model's tip contradicted `fact`. */
  tip: string | null;
}

const STRESS_WORD = /\b(stress(ed)?|emphasi[sz]e[sd]?|accent(ed)?|louder|stronger|punch)\b/;
const EARLY_SYLLABLE = /\b(first|second|third|initial|beginning|start|penultimate|second[- ]to[- ]last)\b/;
const LAST_SYLLABLE = /\b(last|final|end)\b/;
const SYLLABLE_POSITION = /\b(first|second|third|last|final|initial|beginning|start|end|penultimate)\b/;

const VOWEL_GROUP = /[aeiouy]+/gi;

function frenchStress(tip: string): TipCheck {
  const said = asserted(tip);
  const wrong = STRESS_WORD.test(said) && EARLY_SYLLABLE.test(said) && !LAST_SYLLABLE.test(said);
  return {
    fact: "French stress falls on the last syllable of the word or phrase, and the others stay even",
    tip: wrong ? "Keep every syllable even, with a little more length on the last one." : null,
  };
}

function koreanStress(tip: string): TipCheck {
  const said = asserted(tip);
  const wrong = STRESS_WORD.test(said) && SYLLABLE_POSITION.test(said);
  return {
    fact: "Korean has no word stress: every syllable gets the same weight",
    tip: wrong ? "Give every syllable the same weight; don't stress one of them." : null,
  };
}

function japanesePitch(tip: string): TipCheck {
  const said = asserted(tip);
  const wrong = STRESS_WORD.test(said);
  return {
    fact: "Japanese accent is pitch, not stress: each mora keeps the same length and loudness",
    tip: wrong ? "Keep every mora the same length and loudness; only the pitch steps up or down." : null,
  };
}

/** Null for one-syllable words, which the rule says nothing about. */
function serbianStress(target: string, tip: string): TipCheck | null {
  const syllables = target.split(/\s+/).map((w) => w.match(VOWEL_GROUP)?.length ?? 0);
  if (!syllables.some((n) => n > 1)) return null;
  const said = asserted(tip);
  const wrong = STRESS_WORD.test(said) && LAST_SYLLABLE.test(said) && !EARLY_SYLLABLE.test(said);
  return {
    fact: "Serbian stress never falls on the last syllable of a longer word",
    tip: wrong ? "Put the stress earlier in the word; Serbian never stresses the last syllable." : null,
  };
}

type KoreanClass = "plain" | "tense" | "aspirated";

// Hangul syllable initials in Unicode order (U+AC00 + initial * 588 + ...).
// Only the stops and affricates, which come in plain/tense/aspirated sets.
const KOREAN_INITIALS: Record<number, [string, KoreanClass]> = {
  0: ["ㄱ", "plain"],
  1: ["ㄲ", "tense"],
  3: ["ㄷ", "plain"],
  4: ["ㄸ", "tense"],
  7: ["ㅂ", "plain"],
  8: ["ㅃ", "tense"],
  9: ["ㅅ", "plain"],
  10: ["ㅆ", "tense"],
  12: ["ㅈ", "plain"],
  13: ["ㅉ", "tense"],
  14: ["ㅊ", "aspirated"],
  15: ["ㅋ", "aspirated"],
  16: ["ㅌ", "aspirated"],
  17: ["ㅍ", "aspirated"],
};

const KOREAN_CLASS: Record<KoreanClass, { how: string; words: RegExp }> = {
  plain: { how: "relaxed, with a light breath", words: /\b(plain|lax|relaxed|soft|gentle|light)\b/ },
  tense: { how: "tight throat, no puff of air", words: /\b(tense|tight|stiff|double|doubled|squeez\w*|no (puff|air))\b/ },
  aspirated: { how: "a strong puff of air", words: /\b(aspirat\w*|puff|breathy|burst|blow|strong air)\b/ },
};

/** The distinct stop and affricate initials in a Hangul word, in order. */
export function koreanInitials(text: string): [string, KoreanClass][] {
  const seen = new Map<string, KoreanClass>();
  for (const ch of text) {
    const code = ch.codePointAt(0)! - 0xac00;
    if (code < 0 || code > 11171) continue;
    const initial = KOREAN_INITIALS[Math.floor(code / 588)];
    if (initial) seen.set(initial[0], initial[1]);
  }
  return [...seen];
}

/** Null when the word has no consonant of the three sets. */
function koreanConsonant(target: string, tip: string): TipCheck | null {
  const initials = koreanInitials(target).slice(0, 4);
  if (initials.length === 0) return null;
  const present = new Set(initials.map(([, c]) => c));
  const said = asserted(tip);
  // Wrong only when the tip describes a set the word has none of.
  const wrong = (Object.keys(KOREAN_CLASS) as KoreanClass[]).some(
    (c) => !present.has(c) && KOREAN_CLASS[c].words.test(said),
  );
  const fact = initials.map(([j, c]) => `${j} is ${c} (${KOREAN_CLASS[c].how})`).join("; ");
  const tip_ = initials.map(([j, c]) => `${j}: ${KOREAN_CLASS[c].how}`).join("; ");
  return { fact, tip: wrong ? `${tip_.charAt(0).toUpperCase()}${tip_.slice(1)}.` : null };
}

const SERBIAN_SOFT = /\b(soft|palatal|flat tongue|middle of (your|the) tongue|front)\b/;
const SERBIAN_HARD = /\b(hard|curl\w*|retroflex|round\w*|tip of (your|the) tongue)\b/;

/** č/dž are hard and ć/đ soft. Null when the word has only one side, or neither. */
function serbianConsonant(target: string, tip: string): TipCheck | null {
  const word = target.toLowerCase();
  const soft = /[ćđ]/.test(word);
  const hard = /č|dž/.test(word);
  if (soft === hard) return null;
  const said = asserted(tip);
  if (soft) {
    return {
      fact: "ć and đ are the soft pair: flat tongue, lips relaxed",
      tip: SERBIAN_HARD.test(said) && !SERBIAN_SOFT.test(said)
        ? "Soft: press the flat middle of your tongue to the roof of your mouth, lips relaxed."
        : null,
    };
  }
  return {
    fact: "č and dž are the hard pair: tongue tip raised, lips slightly rounded",
    tip: SERBIAN_SOFT.test(said) && !SERBIAN_HARD.test(said)
      ? "Hard: raise the tip of your tongue behind your teeth and round your lips a little."
      : null,
  };
}

/**
 * Check a tip for a non-tonal language against that language's rules. Null
 * when no rule covers the note, which is then saved as given.
 */
export function checkTip(
  language: ProfileCode,
  issue: PronunciationIssue,
  target: string,
  tip: string,
): TipCheck | null {
  if (language === "fr" && issue === "stress") return frenchStress(tip);
  if (language === "ko" && issue === "stress") return koreanStress(tip);
  if (language === "ko" && issue === "consonant") return koreanConsonant(target, tip);
  if (language === "ja" && issue === "pitch") return japanesePitch(tip);
  if (language === "sr" && issue === "stress") return serbianStress(target, tip);
  if (language === "sr" && issue === "consonant") return serbianConsonant(target, tip);
  return null;
}
