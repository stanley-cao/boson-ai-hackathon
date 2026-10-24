import { PROFILES, TARGET_LANGUAGE_CODES, type TargetLanguageCode } from "../lang/profiles";
import type { SpeakingPace } from "../tools/handlers";
import { AUDIO_RATE } from "./sessionConfig";

// One syllable per character in these scripts.
const SYLLABIC_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const LATIN_WORD = /[\p{Script=Latin}']+/gu;

/**
 * A rough syllable count for a reply. Tutor replies mix English and Mandarin,
 * and a Han character is a syllable where a Latin letter is not, so counting
 * characters would make an English-heavy reply look fast. Latin words count
 * their vowel groups, less a silent final "e"; close enough to compare pace.
 */
export function estimateSyllables(text: string): number {
  let n = text.match(SYLLABIC_CHAR)?.length ?? 0;
  for (const word of text.match(LATIN_WORD) ?? []) {
    const w = word.toLowerCase();
    let groups = w.match(/[aeiouyàâéèêëîïôûùüÿœæ]+/g)?.length ?? 0;
    if (groups > 1 && /[^aeiouy]e$/.test(w) && !/le$/.test(w)) groups--;
    n += Math.max(1, groups);
  }
  return n;
}

/**
 * Milliseconds of output audio per spoken syllable, the probe's measure of
 * speaking pace (#76). Higher is slower; conversational speech is roughly
 * 200–250. Null when there is nothing to divide.
 */
export function paceMsPerSyllable(samples: number, transcript: string): number | null {
  const syllables = estimateSyllables(transcript);
  if (syllables === 0 || samples <= 0) return null;
  return ((samples / AUDIO_RATE) * 1000) / syllables;
}

// Higgs TTS control tags (docs.boson.ai/models/higgs-tts/tags.md): about
// 0.85x and 0.65x speed.
const SPEED_TAGS: Record<Exclude<SpeakingPace, "normal">, string> = {
  slow: "<|prosody:speed_slow|>",
  slower: "<|prosody:speed_very_slow|>",
};
// The cap /api/tts enforces (TTS_MAX_INPUT_CHARS in server/index.ts), tags included.
const TTS_MAX_CHARS = 500;

// One syllable per character: Han and Hangul blocks. Not kana or Japanese
// kanji: 今日 is one word, kyō, and said a character at a time it becomes
// ima, hi.
const SYLLABLE_CHAR = /[\p{Script=Han}\p{Script=Hangul}]/u;
const JAPANESE_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
// A Latin word carrying a tone mark is a pinyin syllable, not English.
const PINYIN_SYLLABLE = /^[\p{Script=Latin}]*[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ][\p{Script=Latin}]*$/u;
const LATIN_WORD_CHAR = /\p{Script=Latin}/u;
// Already a stop, so no extra one is needed after the syllable before it.
const PUNCTUATION = /^\p{P}/u;
const SENTENCE_STOP = /^[.,!?;:…。！？、，]/u;

export interface SlowSpeechOptions {
  /** The language being practised. Without one, the line is read as Mandarin. */
  language?: TargetLanguageCode;
  /** How slow: "slow" by default, "slower" for "even slower". */
  pace?: Exclude<SpeakingPace, "normal">;
  /**
   * The whole line is in `language` (a saved correction, phrase or note), so
   * every Latin word is split, not only pinyin. A tutor reply mixes in
   * English, which is left whole.
   */
  wholeTarget?: boolean;
}

/** A stop after every Han or Hangul character not already followed by one. */
function stopPerCharacter(text: string): string {
  let out = "";
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    out += chars[i];
    const next = chars[i + 1];
    if (SYLLABLE_CHAR.test(chars[i]) && next !== undefined && !PUNCTUATION.test(next)) out += "。";
  }
  return out;
}

/**
 * A stop after every Japanese word, found with the platform's word
 * segmenter. Left as it is where there is no Intl.Segmenter: slowed but
 * whole beats split in the wrong places.
 */
function stopPerJapaneseWord(text: string): string {
  if (typeof Intl.Segmenter !== "function") return text;
  const segments = [...new Intl.Segmenter("ja", { granularity: "word" }).segment(text)];
  return segments
    .map(({ segment }, i) => {
      const next = segments[i + 1]?.segment;
      const split = JAPANESE_CHAR.test(segment) && next !== undefined && !PUNCTUATION.test(next);
      return split ? `${segment}。` : segment;
    })
    .join("");
}

/** A full stop after each word `split` picks, keeping brackets and quotes outside. */
function stopPerWord(text: string, split: (bare: string) => boolean): string {
  return text
    .split(/(\s+)/)
    .map((word) => {
      // "(wǒ" -> "(wǒ.", "guǎn)" -> "guǎn.)"; "merci." keeps its one stop.
      const [, lead, bare, trail] = word.match(/^(\p{P}*)(.*?)(\p{P}*)$/u)!;
      if (!split(bare)) return word;
      return SENTENCE_STOP.test(trail) ? word : `${lead}${bare}.${trail}`;
    })
    .join("");
}

/**
 * Higgs TTS input that says `text` slowly, syllable by syllable, for "say
 * that again slowly" (#76).
 *
 * Each Mandarin or Korean syllable, each Japanese word and each pinyin word
 * ends in a full stop, so TTS says it on its own; English stays whole and is
 * only slowed. For a line wholly in a Latin-script target (French, Serbian,
 * Vietnamese) every word is split, which for Vietnamese is every syllable.
 * Probed 2026-10-24 on 我今天想去图书馆学习: speed_slow plus a stop per
 * syllable ran 5.4–5.7 s against ~2 s plain, came out as separate bursts, and
 * transcribed back exactly. Pause tags between words, the first version, ran
 * as long but came out as five even chunks that transcribed as an unrelated
 * repeated phrase; commas or spaces barely slowed it. The stop per word for
 * Japanese and Latin scripts, and speed_very_slow, are unprobed. Null when
 * there is nothing to say, or the line is too long for one request; a long
 * line is said in parts through `slowSpeechChunks`.
 */
export function slowSpeechInput(text: string, options: SlowSpeechOptions = {}): string | null {
  const chunks = slowSpeechChunks(text, options);
  return chunks?.length === 1 ? chunks[0] : null;
}

/**
 * `slowSpeechInput` for a line of any length: TTS inputs of at most
 * TTS_MAX_CHARS each, tag included, to be played one after another. Parts end
 * at a syllable or word stop where they can, so no word is cut in two. Null
 * when there is nothing to say.
 */
export function slowSpeechChunks(text: string, options: SlowSpeechOptions = {}): string[] | null {
  if (!/[\p{L}\p{N}]/u.test(text)) return null;
  const { language, pace = "slow", wholeTarget = false } = options;

  const trimmed = text.trim();
  let out = language === "ja" ? stopPerJapaneseWord(trimmed) : stopPerCharacter(trimmed);
  if (wholeTarget && language !== undefined && PROFILES[language].script === "Latn") {
    out = stopPerWord(out, (bare) => LATIN_WORD_CHAR.test(bare));
  } else if (language === undefined || PROFILES[language].romanization === "pinyin") {
    // Pinyin syllables are whole words, so they are split on spaces.
    out = stopPerWord(out, (bare) => PINYIN_SYLLABLE.test(bare));
  }

  const tag = SPEED_TAGS[pace];
  return splitAtStops(out, TTS_MAX_CHARS - Array.from(tag).length).map((part) => tag + part);
}

// Where a part may end: after a stop or a space. Kept on the earlier part.
const BREAK_AFTER = /[。.!?！？,，、;；:\s]/u;

/** `text` in parts of at most `max` characters, each broken after a stop or space if there is one. */
function splitAtStops(text: string, max: number): string[] {
  const chars = Array.from(text);
  const parts: string[] = [];
  let start = 0;
  while (chars.length - start > max) {
    let end = start + max;
    // Back up to the last break in this window; with none, cut at the limit.
    for (let i = end - 1; i > start; i--) {
      if (BREAK_AFTER.test(chars[i])) {
        end = i + 1;
        break;
      }
    }
    parts.push(chars.slice(start, end).join("").trim());
    start = end;
  }
  parts.push(chars.slice(start).join("").trim());
  return parts.filter((part) => /[\p{L}\p{N}]/u.test(part));
}

/** The item a slow repeat should say instead of the whole reply. */
export interface PracticeFocus {
  text: string;
  language: TargetLanguageCode;
}

/**
 * The target-language line a study tool's result centres the next reply on:
 * a correction's fix, a saved phrase, a pronunciation note's word. Null for
 * any other result, or a language that isn't a target. Results arrive as
 * `unknown` from the registry, so the shape is checked rather than trusted.
 */
export function practiceFocusFromTool(result: unknown): PracticeFocus | null {
  const detail = (result as { detail?: Record<string, unknown> } | null)?.detail;
  const text =
    detail?.type === "correction"
      ? detail.correct
      : detail?.type === "phrase"
        ? detail.phrase
        : detail?.type === "pronunciation"
          ? detail.target
          : undefined;
  const language = TARGET_LANGUAGE_CODES.find((code) => code === detail?.language);
  return typeof text === "string" && text.trim() && language ? { text: text.trim(), language } : null;
}
