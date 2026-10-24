import { PROFILES, type LanguageProfile, type ProfileCode } from "../lang/profiles";
import type { Correction, Phrase, PracticeLanguage, PronunciationNote, QuizAnswer, QuizCategory, ToolDetail } from "./types";

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

// Names a model is likely to send for each profile. The schema enum says "zh",
// but models also say the language's name or a locale tag, so both map here.
const LANGUAGE_ALIASES: Record<string, ProfileCode> = {
  en: "en",
  english: "en",
  zh: "zh",
  mandarin: "zh",
  chinese: "zh",
  "mandarin chinese": "zh",
  ko: "ko",
  korean: "ko",
  fr: "fr",
  french: "fr",
  français: "fr",
  francais: "fr",
  ja: "ja",
  japanese: "ja",
  nihongo: "ja",
  sr: "sr",
  serbian: "sr",
  srpski: "sr",
};

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

const QUIZ_CATEGORIES = new Set<QuizCategory>(["translation", "vocabulary", "grammar", "comprehension"]);

/** Validate and record one quiz grade without ever throwing. */
export function gradeQuizAnswer(args: Record<string, unknown>): ToolResult {
  const language = normalizeLanguage(args.language);
  const questionNumber = args.question_number;
  const category = args.category;
  const source = args.source;
  const points = args.points;
  const question = normalizeText(args.question);
  const learnerAnswer = normalizeText(args.learner_answer);
  const referenceAnswer = normalizeText(args.reference_answer);
  const feedback = normalizeText(args.feedback);
  if (!language) return { summary: "Quiz grade not recorded: unknown language.", error: "unknown_language" };
  if (!Number.isInteger(questionNumber) || Number(questionNumber) < 1 || Number(questionNumber) > 5) {
    return { summary: "Quiz grade not recorded: question number must be 1 through 5.", error: "invalid_question_number" };
  }
  if (typeof category !== "string" || !QUIZ_CATEGORIES.has(category as QuizCategory)) {
    return { summary: "Quiz grade not recorded: invalid category.", error: "invalid_category" };
  }
  if (source !== "review" && source !== "general") {
    return { summary: "Quiz grade not recorded: invalid source.", error: "invalid_source" };
  }
  if (points !== 0 && points !== 1 && points !== 2) {
    return { summary: "Quiz grade not recorded: points must be 0, 1, or 2.", error: "invalid_points" };
  }
  if (!question || !learnerAnswer || !referenceAnswer || !feedback) {
    return { summary: "Quiz grade not recorded: all answer fields are required.", error: "missing_fields" };
  }
  const detail: QuizAnswer = {
    type: "quiz_answer",
    language,
    questionNumber: questionNumber as QuizAnswer["questionNumber"],
    category: category as QuizCategory,
    source,
    question,
    learnerAnswer,
    referenceAnswer,
    points,
    feedback,
  };
  return {
    detail,
    summary: questionNumber === 5
      ? "Final answer recorded. Give one short explanation, say the quiz is complete, and ask the learner to end the session to see the score. Do not announce a numeric score."
      : `Answer ${questionNumber} recorded. Give one short explanation without mentioning points or a running score, then ask question ${Number(questionNumber) + 1} only.`,
  };
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

// A character of each non-Latin profile script, and what to call the script
// when asking the model to write in it. Japanese mixes kanji and kana.
const SCRIPTS: Partial<Record<LanguageProfile["script"], { pattern: RegExp; name: string }>> = {
  Hans: { pattern: /\p{Script=Han}/u, name: "Chinese characters" },
  Hang: { pattern: /\p{Script=Hangul}/u, name: "Hangul" },
  Jpan: { pattern: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, name: "Japanese script" },
};

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
  const script = SCRIPTS[PROFILES[language].script];
  if (script && !script.pattern.test(correct)) {
    return {
      summary: `Correction not saved: write the corrected version in ${script.name}, and put the romanization in romanization.`,
      error: "wrong_script",
    };
  }

  const romanization = normalizeText(args.romanization);
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
 * tutor has no teaching notes for it yet, and the summary names the languages
 * it does have, so the model can offer those instead.
 */
export function setPracticeLanguage(args: Record<string, unknown>): ToolResult {
  const language = normalizeLanguage(args.language);
  if (!language) {
    const names = Object.values(PROFILES)
      .map((p) => p.name)
      .join(" or ");
    return {
      summary: `That language isn't available yet. The learner can practise ${names}.`,
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
const PRONUNCIATION_ISSUES: Record<string, PronunciationNote["issue"]> = {
  tone: "tone",
  tonal: "tone",
  initial: "initial",
  consonant: "initial",
  final: "final",
  vowel: "final",
};

function normalizePronunciationIssue(raw: unknown): PronunciationNote["issue"] {
  if (typeof raw !== "string") return "other";
  // Word by word, so "Tones", "wrong tone" and "tone_error" all file as tone.
  for (const word of raw.toLowerCase().split(/[\s_-]+/)) {
    const w = word.replace(/s$/, "");
    if (Object.hasOwn(PRONUNCIATION_ISSUES, w)) return PRONUNCIATION_ISSUES[w];
  }
  return "other";
}

type Tone = 1 | 2 | 3 | 4 | 5;
type Movement = "level" | "rise" | "fall" | "dip";

// Mandarin tones as a learner is told them. Probed live, the tip for 妈 (mā)
// once described the rising second tone, and the tutor read it aloud. So for a
// tone note the handler states the contour from the pinyin itself, and drops a
// tip that describes a movement the tone doesn't have (#55).
const TONES: Record<Tone, { name: string; contour: string; tip: string; moves: Movement[] }> = {
  1: { name: "first tone", contour: "high and level", tip: "start high and keep it level", moves: ["level"] },
  2: { name: "second tone", contour: "rising, like a question", tip: "start in the middle and rise, as if asking a question", moves: ["rise"] },
  // A full third tone falls and then rises, so a tip may mention any of these.
  3: { name: "third tone", contour: "low and dipping", tip: "dip low, then rise a little", moves: ["dip", "fall", "rise"] },
  4: { name: "fourth tone", contour: "sharply falling", tip: "start high and fall sharply", moves: ["fall"] },
  5: { name: "neutral tone", contour: "short and light", tip: "keep it short and light, without stress", moves: [] },
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

/** "mā, first tone: high and level", one clause per word. */
function describeTones(words: WordTones[]): string {
  return words
    .map(({ word, tones }) => `${word}, ${tones.map((t) => `${TONES[t].name}: ${TONES[t].contour}`).join(", then ")}`)
    .join("; ");
}

/** The card's tip for these tones, used when the model's own tip contradicts them. */
function toneTip(words: WordTones[]): string {
  const perWord = words.map(({ word, tones }) => {
    const tip = tones.map((t) => TONES[t].tip).join(", then ");
    return words.length === 1 ? tip : `${word}: ${tip}`;
  });
  const tip = perWord.join("; ");
  return `${tip.charAt(0).toUpperCase()}${tip.slice(1)}.`;
}

// From a negation to the end of its clause. Probed live, a correct first-tone
// tip ended "try saying it without dipping or rising".
const NEGATED_CLAUSE = /\b(without|not|no|never|don't|do not|avoid|instead of|rather than)\b[^.,;:!?]*/g;

/** True when the tip describes a pitch movement that none of these tones has. */
function tipContradicts(tip: string, words: WordTones[]): boolean {
  const allowed = new Set(words.flatMap(({ tones }) => tones.flatMap((t) => TONES[t].moves)));
  const text = tip.toLowerCase().replace(/’/g, "'").replace(NEGATED_CLAUSE, "");
  return (Object.keys(MOVEMENT_WORDS) as Movement[]).some(
    (move) => !allowed.has(move) && MOVEMENT_WORDS[move].test(text),
  );
}

/**
 * Save a pronunciation note: the Mandarin showcase, since the model hears the
 * learner's tones directly rather than through a transcript.
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

  const romanization = normalizeText(args.romanization);
  const issue = normalizePronunciationIssue(args.issue);
  const tones =
    issue === "tone" && PROFILES[language].romanization === "pinyin" && romanization
      ? pinyinTones(romanization)
      : null;
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

  const romanization = normalizeText(args.romanization);
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

export type SpeakingPace = "slow" | "normal";

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
  const pace = /normal|fast|quick|natural|regular/i.test(String(args.pace ?? "")) ? "normal" : "slow";
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
  if (scope === "once") {
    return {
      summary:
        "Now repeat the content of your previous reply exactly, slowly, syllable by syllable with a short pause after each. Add nothing new.",
    };
  }
  return { summary: "You'll speak slowly from now on. Say so in a few words, then carry on." };
}

export const handlers: Record<string, (args: Record<string, unknown>) => ToolResult> = {
  note_correction: noteCorrection,
  set_practice_language: setPracticeLanguage,
  pronunciation_feedback: pronunciationFeedback,
  save_phrase: savePhrase,
  set_speaking_pace: setSpeakingPace,
  grade_quiz_answer: gradeQuizAnswer,
};
