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

// Higgs TTS control tag (docs.boson.ai/models/higgs-tts/tags.md).
const SPEED_SLOW = "<|prosody:speed_slow|>";
// The cap /api/tts enforces (TTS_MAX_INPUT_CHARS in server/index.ts), tags included.
const TTS_MAX_CHARS = 500;

// One syllable per character: Han, kana and Hangul blocks.
const SYLLABLE_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// A Latin word carrying a tone mark is a pinyin syllable, not English.
const PINYIN_SYLLABLE = /^[\p{Script=Latin}]*[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ][\p{Script=Latin}]*$/u;
// Already a stop, so no extra one is needed after the syllable before it.
const PUNCTUATION = /^\p{P}/u;

/**
 * Higgs TTS input that says `text` slowly, syllable by syllable, for "say
 * that again slowly" (#76).
 *
 * Each Mandarin character, and each pinyin word, ends in a full stop, so TTS
 * says it on its own; English stays whole and is only slowed. Probed
 * 2026-10-24 on 我今天想去图书馆学习: speed_slow plus a stop per syllable ran
 * 5.4–5.7 s against ~2 s plain, came out as separate bursts, and transcribed
 * back exactly. Pause tags between words, the first version, ran as long but
 * came out as five even chunks that transcribed as an unrelated repeated
 * phrase; commas or spaces barely slowed it. Null when there is nothing to
 * say, or the line is too long for the route.
 */
export function slowSpeechInput(text: string): string | null {
  if (!/[\p{L}\p{N}]/u.test(text)) return null;

  let out = "";
  const chars = Array.from(text.trim());
  for (let i = 0; i < chars.length; i++) {
    out += chars[i];
    const next = chars[i + 1];
    if (SYLLABLE_CHAR.test(chars[i]) && next !== undefined && !PUNCTUATION.test(next)) out += "。";
  }
  // Pinyin syllables are whole words, so they are split on spaces.
  out = out
    .split(/(\s+)/)
    .map((word) => {
      // Brackets and quotes stay outside: "(wǒ" -> "(wǒ.", "guǎn)" -> "guǎn.)".
      const [, lead, bare, trail] = word.match(/^(\p{P}*)(.*?)(\p{P}*)$/u)!;
      return PINYIN_SYLLABLE.test(bare) ? `${lead}${bare}.${trail}` : word;
    })
    .join("");

  const input = SPEED_SLOW + out;
  return Array.from(input).length <= TTS_MAX_CHARS ? input : null;
}
