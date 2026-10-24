import {
  PROFILES,
  SCRIPT_PATTERNS,
  TARGET_LANGUAGE_CODES,
  type ProfileCode,
  type TargetLanguageCode,
} from "../lang/profiles";
import type {
  Correction,
  Phrase,
  PracticeLanguage,
  PronunciationIssue,
  PronunciationNote,
  ToolDetail,
} from "./types";

/**
 * The result shape every tool returns.
 *
 * `summary` is written to be SPOKEN. `detail` is the structured data behind it.
 * Both go back to the model, and the split matters more than it looks — see the
 * "shaping results for a voice" section of docs/part-4.md.
 *
 * `detail` is one of the shapes in ./types.ts, which is what the study panel
 * renders from, so a handler cannot hand the UI something it doesn't know.
 */
export interface ToolResult {
  summary: string;
  detail?: ToolDetail;
  error?: string;
}

// Names for a profile besides its own English name: what the language calls
// itself, and other English names for it ("Farsi", "Slovenian").
const EXTRA_NAMES: Partial<Record<ProfileCode, string[]>> = {
  zh: ["mandarin", "chinese"],
  fr: ["français"],
  ja: ["nihongo"],
  sr: ["srpski"],
  vi: ["tiếng việt"],
  ckb: ["kurdish", "sorani"],
  de: ["deutsch"],
  es: ["español", "castilian"],
  fa: ["farsi"],
  ht: ["haitian", "kreyòl"],
  id: ["bahasa indonesia"],
  ky: ["kirghiz"],
  luo: ["dholuo"],
  mhr: ["meadow mari"],
  ms: ["bahasa melayu"],
  no: ["norsk", "bokmål"],
  nso: ["northern sotho"],
  pt: ["português"],
  sl: ["slovenian"],
  sw: ["kiswahili"],
  tl: ["filipino"],
  ug: ["uighur"],
  xh: ["isixhosa"],
  zu: ["isizulu"],
};

// "Māori" -> "maori", "tiếng việt" -> "tieng viet": a name typed or sent
// without its accents still counts.
const withoutMarks = (name: string): string => name.normalize("NFD").replace(/\p{M}/gu, "");

/**
 * Every name for each profile, lowercase, with and without accents. Codes are
 * left out on purpose: the LiveKit agent matches these in speech (exported to
 * shared/languages.json), where "it" or "no" is an ordinary word.
 */
export const LANGUAGE_NAMES = Object.fromEntries(
  Object.values(PROFILES).map((profile) => {
    const names = [profile.name, ...(EXTRA_NAMES[profile.code] ?? [])].map((n) => n.toLowerCase());
    return [profile.code, [...new Set(names.flatMap((n) => [n, withoutMarks(n)]))]];
  }),
) as Record<ProfileCode, string[]>;

/** The names of every target language, for shared/languages.json (LiveKit agent). */
export function targetLanguageNames(): Record<TargetLanguageCode, string[]> {
  return Object.fromEntries(TARGET_LANGUAGE_CODES.map((code) => [code, LANGUAGE_NAMES[code]])) as Record<
    TargetLanguageCode,
    string[]
  >;
}

// What a model may send for each profile. The schema enum says "zh", but
// models also say the language's name or a locale tag, so both map here.
const LANGUAGE_ALIASES: Record<string, ProfileCode> = Object.fromEntries(
  (Object.entries(LANGUAGE_NAMES) as [ProfileCode, string[]][]).flatMap(([code, names]) => [
    [code, code],
    ...names.map((name) => [name, code]),
  ]),
);

/**
 * Normalise a language argument to a profile code, or `null` if we don't
 * recognise it. An unknown value means "no language given", never a thrown
 * error or a guessed language.
 *
 * Locale tags such as "zh-CN" or "en_US" fall back to their base subtag, so
 * "zh-Hant" also maps to `zh`. We only have Simplified-character teaching
 * notes today, so that is a deliberate simplification.
 */
export function normalizeLanguage(raw: unknown): ProfileCode | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/_/g, "-");
  if (Object.hasOwn(LANGUAGE_ALIASES, t)) return LANGUAGE_ALIASES[t];
  const base = t.split("-")[0];
  if (Object.hasOwn(LANGUAGE_ALIASES, base)) return LANGUAGE_ALIASES[base];
  return null;
}

/**
 * A text argument, trimmed, or `null` if it is missing or blank. Blank counts
 * as missing so that an optional field sent as "" never becomes an empty line
 * on a study card.
 */
function normalizeText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t : null;
}

/**
 * A romanization only for a language written in another script. Live, a
 * French correction came back with made-up pinyin in `romanization`, which
 * the study panel would show under the French.
 */
function romanizationFor(language: ProfileCode, raw: unknown): string | null {
  return "romanization" in PROFILES[language] ? normalizeText(raw) : null;
}

// What a model may call each correction kind besides the enum value itself.
// Anything else files as "other": a mislabelled kind should still save the
// correction, not lose it.
const CORRECTION_KINDS: Record<string, Correction["kind"]> = {
  grammar: "grammar",
  grammatical: "grammar",
  "word order": "grammar",
  "measure word": "grammar",
  particle: "grammar",
  vocabulary: "vocabulary",
  vocab: "vocabulary",
  word: "vocabulary",
  "word choice": "vocabulary",
};

function normalizeCorrectionKind(raw: unknown): Correction["kind"] {
  if (typeof raw !== "string") return "other";
  // "Word_Order" -> "word order", "measure words" -> "measure word".
  const t = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/s$/, "");
  return Object.hasOwn(CORRECTION_KINDS, t) ? CORRECTION_KINDS[t] : "other";
}

/**
 * Text reduced to what a correction can change: case, spacing and
 * punctuation are dropped, so "我有三个狗" and "我有三个狗。" compare equal.
 */
function comparable(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}


/**
 * Record a correction for the study panel.
 *
 * The schema tells the model to call this BEFORE it speaks, so the summary is
 * its cue for what to say next rather than a line to read out. Verified
 * 2026-10-23 with the probe: "call this in the same turn as you correct"
 * descriptions were called in 9 of 37 runs, while "call this first" was
 * called in 24 of 24.
 *
 * Two calls are refused rather than saved, both seen live on 2026-10-24 when
 * a question about tones had no other tool to go to: `correct` identical to
 * `said` ("mā hē mā" → "mā hē mā"), and pinyin in place of characters
 * ("我" → "wǒ"). Only `correct` is checked for script: `said` is what was
 * heard, which may be mis-transcribed or mixed-language.
 */
export function noteCorrection(args: Record<string, unknown>): ToolResult {
  const language = normalizeLanguage(args.language);
  if (!language) {
    return {
      summary: `Correction not saved: language must be one of ${Object.keys(PROFILES).join(", ")}.`,
      error: "unknown_language",
    };
  }

  const said = normalizeText(args.said);
  const correct = normalizeText(args.correct);
  if (!said || !correct) {
    return {
      summary: "Correction not saved: it needs what the learner said and the corrected version.",
      error: "missing_fields",
    };
  }

  if (comparable(said) === comparable(correct)) {
    return {
      summary:
        "Correction not saved: the corrected version is the same as what they said. " +
        "If there was no mistake, don't call this; just carry on the conversation.",
      error: "same_as_said",
    };
  }

  // A summary naming the right script lets the model retry the call.
  const script = SCRIPT_PATTERNS[PROFILES[language].script];
  if (script && !script.pattern.test(correct)) {
    return {
      summary: `Correction not saved: write the corrected version in ${script.name}, and put the romanization in romanization.`,
      error: "wrong_script",
    };
  }

  const romanization = romanizationFor(language, args.romanization);
  const detail: Correction = {
    type: "correction",
    language,
    said,
    correct,
    // The tutor has already explained it aloud, so a card without the reason
    // is still worth keeping.
    explanation: normalizeText(args.explanation) ?? "",
    kind: normalizeCorrectionKind(args.kind),
    ...(romanization ? { romanization } : {}),
  };
  return {
    summary: `Saved. Say the corrected version clearly exactly once: ${correct} Then briefly explain why and carry on the conversation.`,
    detail,
  };
}

// What a model may call each level besides the enum value itself.
const LEVELS: Record<string, PracticeLanguage["level"]> = {
  beginner: "beginner",
  novice: "beginner",
  basic: "beginner",
  intermediate: "intermediate",
  advanced: "advanced",
  fluent: "advanced",
};

/**
 * The level, or "beginner" when the model sent none we recognise. The summary
 * says the level aloud, so a wrong default is heard and can be corrected.
 */
function normalizeLevel(raw: unknown): PracticeLanguage["level"] {
  if (typeof raw !== "string") return "beginner";
  const t = raw.trim().toLowerCase().replace(/s$/, ""); // "Beginners" -> "beginner"
  return Object.hasOwn(LEVELS, t) ? LEVELS[t] : "beginner";
}

/**
 * Switch the language or level being practised, for the "practising" badge.
 *
 * A language without a profile is an error rather than a silent switch: the
 * tutor has no teaching notes for it yet. The summary doesn't list the ones it
 * has, because 85 names would be read aloud; the schema's enum already lists them.
 */
export function setPracticeLanguage(args: Record<string, unknown>): ToolResult {
  const language = normalizeLanguage(args.language);
  if (!language) {
    return {
      summary:
        "That language isn't available yet. Tell the learner in a few words, and offer a close language you can teach instead.",
      error: "unknown_language",
    };
  }

  const level = normalizeLevel(args.level);
  const detail: PracticeLanguage = { type: "practice_language", language, level };
  return {
    summary: `Now practising ${PROFILES[language].name} at ${level} level. Confirm that to the learner in a few words, then carry on the conversation.`,
    detail,
  };
}

// Words that name each pronunciation issue. Anything else files as "other":
// a mislabelled issue should still save the note, not lose it.
const ISSUE_WORDS: Record<string, PronunciationIssue> = {
  tone: "tone",
  tonal: "tone",
  initial: "initial",
  final: "final",
  consonant: "consonant",
  vowel: "vowel",
  stress: "stress",
  stressed: "stress",
  emphasis: "stress",
  pitch: "pitch",
  accent: "pitch",
  intonation: "pitch",
};

// The terms each language's notes are filed under. Mandarin syllables are
// taught as initial + final + tone; the other languages have no "final", so
// the model's Mandarin habits (it was told about tones first) are mapped onto
// consonant / vowel there, and "tone" onto pitch where there are no tones.
const MANDARIN_TERMS: Partial<Record<PronunciationIssue, PronunciationIssue>> = {
  consonant: "initial",
  vowel: "final",
  pitch: "tone",
};
const TONAL_TERMS: Partial<Record<PronunciationIssue, PronunciationIssue>> = {
  initial: "consonant",
  final: "vowel",
  pitch: "tone",
};
const NON_TONAL_TERMS: Partial<Record<PronunciationIssue, PronunciationIssue>> = {
  initial: "consonant",
  final: "vowel",
  tone: "pitch",
};
// Languages where pitch tells words apart, so a "pitch" note is filed as tone.
// Every other language besides Mandarin uses the non-tonal terms.
const TONAL_LANGUAGES: ReadonlySet<ProfileCode> = new Set<ProfileCode>([
  "vi", "th", "ha", "rw", "ln", "luo", "sn", "nso", "xh", "zu",
]);

function issueTerms(language: ProfileCode): Partial<Record<PronunciationIssue, PronunciationIssue>> {
  if (language === "zh") return MANDARIN_TERMS;
  return TONAL_LANGUAGES.has(language) ? TONAL_TERMS : NON_TONAL_TERMS;
}

function normalizePronunciationIssue(raw: unknown, language: ProfileCode): PronunciationIssue {
  if (typeof raw !== "string") return "other";
  // Word by word, so "Tones", "wrong tone" and "tone_error" all file as tone.
  for (const word of raw.toLowerCase().split(/[\s_-]+/)) {
    // The word as sent, then without a plural "s" ("stress" must stay itself).
    const w = Object.hasOwn(ISSUE_WORDS, word) ? word : word.replace(/s$/, "");
    if (Object.hasOwn(ISSUE_WORDS, w)) {
      const issue = ISSUE_WORDS[w];
      return issueTerms(language)[issue] ?? issue;
    }
  }
  return "other";
}

type Movement = "level" | "rise" | "fall" | "dip";

/** One tone as a learner is told it, and the pitch movements a tip may name. */
interface ToneInfo {
  name: string;
  contour: string;
  tip: string;
  moves: Movement[];
}

type Tone = 1 | 2 | 3 | 4 | 5;

// Mandarin tones as a learner is told them. Probed live, the tip for 妈 (mā)
// once described the rising second tone, and the tutor read it aloud. So for a
// tone note the handler states the contour from the pinyin itself, and drops a
// tip that describes a movement the tone doesn't have (#55).
const TONES: Record<Tone, ToneInfo> = {
  1: { name: "first tone", contour: "high and level", tip: "start high and keep it level", moves: ["level"] },
  2: { name: "second tone", contour: "rising, like a question", tip: "start in the middle and rise, as if asking a question", moves: ["rise"] },
  // A full third tone falls and then rises, so a tip may mention any of these.
  3: { name: "third tone", contour: "low and dipping", tip: "dip low, then rise a little", moves: ["dip", "fall", "rise"] },
  4: { name: "fourth tone", contour: "sharply falling", tip: "start high and fall sharply", moves: ["fall"] },
  5: { name: "neutral tone", contour: "short and light", tip: "keep it short and light, without stress", moves: [] },
};

type VietnameseTone = "ngang" | "huyền" | "sắc" | "hỏi" | "ngã" | "nặng";

// The six Northern (Hà Nội) tones, the standard taught to learners. Same job
// as TONES: the contour comes from the tone mark, not from the model's tip.
const VIETNAMESE_TONES: Record<VietnameseTone, ToneInfo> = {
  ngang: { name: "level tone (ngang)", contour: "mid and level", tip: "keep it mid and level", moves: ["level"] },
  huyền: { name: "falling tone (huyền)", contour: "low and gently falling", tip: "start low and let it fall gently", moves: ["fall"] },
  sắc: { name: "rising tone (sắc)", contour: "high and rising", tip: "start mid and rise sharply", moves: ["rise"] },
  hỏi: { name: "dipping tone (hỏi)", contour: "dipping, then rising", tip: "dip down, then come back up", moves: ["dip", "fall", "rise"] },
  // Rises with a catch in the throat partway through.
  ngã: { name: "broken rising tone (ngã)", contour: "rising with a break", tip: "rise, with a short catch in the middle", moves: ["rise", "dip"] },
  nặng: { name: "heavy tone (nặng)", contour: "low, short and dropping", tip: "drop low and cut it short", moves: ["fall"] },
};

const MOVEMENT_WORDS: Record<Movement, RegExp> = {
  level: /\b(level|flat|steady)\b/,
  rise: /\b(rise|rises|rising|raise|raises|raising|go(es)? up|going up|upwards?|climb(s|ing)?|question)\b/,
  fall: /\b(fall|falls|falling|drop|drops|dropping|go(es)? down|going down|downwards?)\b/,
  dip: /\b(dip|dips|dipping)\b/,
};

// Breve vowels count as the third tone: they look like the caron and models
// sometimes send them instead.
const TONE_MARKS = new Map<string, Tone>();
for (const [tone, vowels] of [
  [1, "āēīōūǖ"],
  [2, "áéíóúǘ"],
  [3, "ǎěǐǒǔǚăĕĭŏŭ"],
  [4, "àèìòùǜ"],
] as const) {
  for (const vowel of vowels) TONE_MARKS.set(vowel, tone);
}

const PINYIN_WORD = /^[a-zü:v0-5āēīōūǖáéíóúǘǎěǐǒǔǚăĕĭŏŭàèìòùǜ]+$/;
const VOWEL_CLUSTER = /[aeiouüvāēīōūǖáéíóúǘǎěǐǒǔǚăĕĭŏŭàèìòùǜ]+/g;

interface WordTones {
  word: string;
  tones: Tone[];
}

/** A word and the tones it carries, in whichever language's tone set. */
interface WordToneInfo {
  word: string;
  tones: ToneInfo[];
}

/**
 * The tones in a pinyin string, word by word, read from tone marks or from
 * tone numbers ("ma1"), which models sometimes send despite the schema.
 *
 * Returns null when the string isn't plain pinyin, or carries no tone marks or
 * numbers at all. An unmarked "ma" may be a neutral tone or a mark the model
 * left out, and stating the wrong tone is the bug this exists to prevent. Once
 * marks are in use, an unmarked syllable is neutral: each syllable has one
 * vowel cluster, so "māma" reads as mā and a neutral ma.
 */
export function pinyinTones(pinyin: string): WordTones[] | null {
  const words = pinyin.normalize("NFC").toLowerCase().split(/[\s'’-]+/).filter(Boolean);
  if (words.length === 0 || !words.every((w) => PINYIN_WORD.test(w))) return null;

  let marked = false;
  const read = words.map((word) => {
    const numbered = [...word.matchAll(/[a-zü:v]+([0-5])/g)];
    if (numbered.length > 0) {
      marked = true;
      return { word, tones: numbered.map((m) => (m[1] === "0" || m[1] === "5" ? 5 : Number(m[1])) as Tone) };
    }
    const tones = (word.match(VOWEL_CLUSTER) ?? []).flatMap((cluster): Tone[] => {
      const marks = [...cluster].flatMap((ch) => TONE_MARKS.get(ch) ?? []);
      if (marks.length > 0) marked = true;
      return marks.length > 0 ? marks : [5];
    });
    return { word, tones };
  });
  return marked && read.every((w) => w.tones.length > 0) ? read : null;
}

// Vietnamese tone marks as combining characters, after NFD. The circumflex,
// breve and horn (â, ă, ơ, ư) change the vowel, not the tone.
const VIETNAMESE_TONE_MARKS: Record<string, VietnameseTone> = {
  "̀": "huyền",
  "́": "sắc",
  "̉": "hỏi",
  "̃": "ngã",
  "̣": "nặng",
};
// Any mark only Vietnamese spelling uses, tone or vowel, or đ.
const VIETNAMESE_MARK = /[̛̣̀́̉̃̂̆]|đ/;

/**
 * The tone of each Vietnamese word, one syllable per written word.
 *
 * Returns null when the text isn't plain Latin words, or carries no
 * Vietnamese mark at all: without one, "ma" may be the level tone or a model
 * that dropped every diacritic, and stating the wrong tone is the bug this
 * exists to prevent (as in `pinyinTones`).
 */
export function vietnameseTones(text: string): { word: string; tones: VietnameseTone[] }[] | null {
  const words = text.normalize("NFC").toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (words.length === 0 || !words.every((w) => /^\p{Script=Latin}+$/u.test(w))) return null;
  if (!words.some((w) => VIETNAMESE_MARK.test(w.normalize("NFD")))) return null;
  return words.map((word) => {
    const tone = [...word.normalize("NFD")].flatMap((ch) => VIETNAMESE_TONE_MARKS[ch] ?? [])[0] ?? "ngang";
    return { word, tones: [tone] };
  });
}

/** The tones a tone note is about, or null when they can't be read reliably. */
function noteTones(language: ProfileCode, target: string, romanization: string | null): WordToneInfo[] | null {
  if (PROFILES[language].romanization === "pinyin") {
    const read = romanization ? pinyinTones(romanization) : null;
    return read?.map(({ word, tones }) => ({ word, tones: tones.map((t) => TONES[t]) })) ?? null;
  }
  if (language === "vi") {
    // Vietnamese is written in Latin letters, so the target is its own
    // spelling, tone marks included; a romanization adds nothing to read.
    const read = vietnameseTones(target);
    return read?.map(({ word, tones }) => ({ word, tones: tones.map((t) => VIETNAMESE_TONES[t]) })) ?? null;
  }
  return null;
}

/** "mā, first tone: high and level", one clause per word. */
function describeTones(words: WordToneInfo[]): string {
  return words
    .map(({ word, tones }) => `${word}, ${tones.map((t) => `${t.name}: ${t.contour}`).join(", then ")}`)
    .join("; ");
}

/** The card's tip for these tones, used when the model's own tip contradicts them. */
function toneTip(words: WordToneInfo[]): string {
  const perWord = words.map(({ word, tones }) => {
    const tip = tones.map((t) => t.tip).join(", then ");
    return words.length === 1 ? tip : `${word}: ${tip}`;
  });
  const tip = perWord.join("; ");
  return `${tip.charAt(0).toUpperCase()}${tip.slice(1)}.`;
}

// From a negation to the end of its clause. Probed live, a correct first-tone
// tip ended "try saying it without dipping or rising".
const NEGATED_CLAUSE = /\b(without|not|no|never|don't|do not|avoid|instead of|rather than)\b[^.,;:!?]*/g;

/** True when the tip describes a pitch movement that none of these tones has. */
function tipContradicts(tip: string, words: WordToneInfo[]): boolean {
  const allowed = new Set(words.flatMap(({ tones }) => tones.flatMap((t) => t.moves)));
  const text = tip.toLowerCase().replace(/’/g, "'").replace(NEGATED_CLAUSE, "");
  return (Object.keys(MOVEMENT_WORDS) as Movement[]).some(
    (move) => !allowed.has(move) && MOVEMENT_WORDS[move].test(text),
  );
}

/**
 * Save a pronunciation note. Tone notes are checked against the tone marks in
 * Mandarin and Vietnamese, the two tonal targets, since the model hears the
 * learner's tones directly rather than through a transcript. The other
 * languages' notes are saved as given: a tip about a French vowel has nothing
 * in the text to check it against.
 *
 * The schema tells the model to call this BEFORE it speaks, so the summary is
 * its cue for what to say next rather than a line to read out: a "same turn"
 * description was called far less reliably in live probes.
 */
export function pronunciationFeedback(args: Record<string, unknown>): ToolResult {
  const language = normalizeLanguage(args.language);
  if (!language) {
    return {
      summary: `Note not saved: language must be one of ${Object.keys(PROFILES).join(", ")}.`,
      error: "unknown_language",
    };
  }

  const target = normalizeText(args.target);
  const tip = normalizeText(args.tip);
  if (!target || !tip) {
    return {
      summary: "Note not saved: it needs the word or syllable and a tip.",
      error: "missing_fields",
    };
  }

  const romanization = romanizationFor(language, args.romanization);
  const issue = normalizePronunciationIssue(args.issue, language);
  const tones = issue === "tone" ? noteTones(language, target, romanization) : null;
  const fixedTip = tones && tipContradicts(tip, tones) ? toneTip(tones) : null;
  const detail: PronunciationNote = {
    type: "pronunciation",
    language,
    target,
    issue,
    tip: fixedTip ?? tip,
    ...(romanization ? { romanization } : {}),
  };
  if (!tones) {
    return {
      summary: `Saved a pronunciation note for ${target}. Now say it the right way, give the tip in a few words, then carry on the conversation.`,
      detail,
    };
  }
  // The contour goes in the summary because the summary is what the tutor
  // speaks from; a correct card is no use if it says a different tone aloud.
  return {
    summary:
      `Saved a pronunciation note for ${target}: ${describeTones(tones)}. ` +
      (fixedTip ? "Your tip described a different tone, so it was replaced. " : "") +
      "Now say it the right way, describe that tone in a few words, then carry on the conversation.",
    detail,
  };
}

/**
 * Save a word or phrase to the learner's phrase list.
 *
 * The schema tells the model to call this BEFORE it speaks, so the summary is
 * its cue for what to say next rather than a line to read out: a "same turn"
 * description was called far less reliably in live probes.
 */
export function savePhrase(args: Record<string, unknown>): ToolResult {
  const language = normalizeLanguage(args.language);
  if (!language) {
    return {
      summary: `Phrase not saved: language must be one of ${Object.keys(PROFILES).join(", ")}.`,
      error: "unknown_language",
    };
  }

  const phrase = normalizeText(args.phrase);
  const meaning = normalizeText(args.meaning);
  if (!phrase || !meaning) {
    return {
      summary: "Phrase not saved: it needs the phrase and what it means.",
      error: "missing_fields",
    };
  }

  const romanization = romanizationFor(language, args.romanization);
  const note = normalizeText(args.note);
  const detail: Phrase = {
    type: "phrase",
    language,
    phrase,
    meaning,
    ...(romanization ? { romanization } : {}),
    ...(note ? { note } : {}),
  };
  return {
    summary: `Saved ${phrase} to the phrase list. Now briefly tell the learner what it means, then carry on the conversation.`,
    detail,
  };
}

/** Normal, slow, then slower: the one step below slow, for "even slower". */
export type SpeakingPace = "normal" | "slow" | "slower";

/** The next pace down, for a slow request when the learner is already hearing `pace`. */
export function slowerThan(pace: SpeakingPace): SpeakingPace {
  return pace === "normal" ? "slow" : "slower";
}

const PACE_ORDER: SpeakingPace[] = ["normal", "slow", "slower"];

/**
 * The pace of a one-off slow repeat. "Say that again slowly" when the line
 * was already slow (a slow session, or a slow repeat just played) means
 * slower than that, or the repeat would sound the same.
 */
export function oneOffPace(requested: SpeakingPace, justHeard: SpeakingPace): SpeakingPace {
  const step = slowerThan(justHeard);
  return PACE_ORDER.indexOf(requested) > PACE_ORDER.indexOf(step) ? requested : step;
}

/** A pace change: just the next reply ("once"), or the rest of the session. */
export interface PaceRequest {
  pace: SpeakingPace;
  scope: "once" | "session";
}

/**
 * Normalise `set_speaking_pace` arguments. The model is only told to call it
 * when the learner asks for a change, so anything unrecognised is read as a
 * one-off slow repeat, the cheapest wrong guess. "normal" always applies to
 * the session: a single normal-speed reply means nothing.
 */
export function paceRequestFrom(args: Record<string, unknown>): PaceRequest {
  const raw = String(args.pace ?? "");
  const pace: SpeakingPace = /normal|fast|quick|natural|regular/i.test(raw)
    ? "normal"
    : /slower|slowest|very|extra|even|more/i.test(raw)
      ? "slower"
      : "slow";
  const scope = pace === "normal" || /session|always|rest/i.test(String(args.scope ?? ""))
    ? "session"
    : "once";
  return { pace, scope };
}

/**
 * The result sent instead of the handler's when the client is already playing
 * a slow repeat through TTS. No reply is requested after it, so the tutor
 * doesn't talk over the repeat; the summary only keeps the model's context
 * straight.
 */
export const SLOW_REPEAT_PLAYING: ToolResult = {
  summary: "A slow recording of your previous reply is playing for the learner now. Say nothing.",
};

/**
 * Change how fast the tutor speaks. The handler only words the reply; the
 * pace itself is set by the client. A one-off slow repeat is re-spoken
 * through TTS (`SLOW_REPEAT_PLAYING`), and this summary is the fallback when
 * that isn't possible. A lasting change re-sends the session instructions
 * with a slow-pace sentence (`planPaceChange`): Higgs Realtime has no speed
 * field, and its docs say to set pace through instructions.
 *
 * No `detail`: pace isn't study data, so nothing is added to the panel.
 */
export function setSpeakingPace(args: Record<string, unknown>): ToolResult {
  const { pace, scope } = paceRequestFrom(args);
  if (pace === "normal") {
    return { summary: "Back to your normal pace. Say so in a few words, then carry on." };
  }
  if (scope === "once") return { summary: slowRepeatSummary(null) };
  const how = pace === "slower" ? "very slowly" : "slowly";
  return { summary: `You'll speak ${how} from now on. Say so in a few words, then carry on.` };
}

/**
 * What a one-off slow repeat tells the model to say when the client can't
 * play it through TTS. Right after a correction, phrase or pronunciation note
 * that is the item itself (`text`), not the whole reply with its English tip:
 * that is what the learner wants to hear again.
 */
export function slowRepeatSummary(text: string | null): string {
  const what = text ? `say ${text} again` : "repeat the content of your previous reply exactly";
  return `Now ${what}, slowly, syllable by syllable with a short pause after each. Add nothing new.`;
}

export const handlers: Record<string, (args: Record<string, unknown>) => ToolResult> = {
  note_correction: noteCorrection,
  set_practice_language: setPracticeLanguage,
  pronunciation_feedback: pronunciationFeedback,
  save_phrase: savePhrase,
  set_speaking_pace: setSpeakingPace,
};
