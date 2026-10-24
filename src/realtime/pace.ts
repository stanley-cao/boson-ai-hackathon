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

// Higgs TTS control tags (docs.boson.ai/models/higgs-tts/tags.md).
const SPEED_SLOW = "<|prosody:speed_slow|>";
const PAUSE = "<|prosody:pause|>";
// The cap /api/tts enforces (TTS_MAX_INPUT_CHARS in server/index.ts), tags included.
const TTS_MAX_CHARS = 500;

/**
 * Higgs TTS input that says `text` slowly, for "say that again slowly" (#76).
 *
 * Probed 2026-10-24: Realtime ignores pace in its instructions more often
 * than not, and a speed tag alone barely moved TTS either; slow speed plus a
 * pause between words made a sentence about 3× longer, every time. Words come
 * from Intl.Segmenter, so Mandarin, which has no spaces, is split too. A line
 * too long for the route keeps pauses only at punctuation; null if even that
 * doesn't fit, or there is nothing to say.
 */
export function slowSpeechInput(text: string): string | null {
  const segments = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)];
  if (!segments.some((s) => s.isWordLike)) return null;

  const build = (pauseBetweenWords: boolean): string => {
    let out = SPEED_SLOW;
    let afterWord = false;
    for (const { segment, isWordLike } of segments) {
      if (isWordLike) {
        out += afterWord ? (pauseBetweenWords ? ` ${PAUSE} ` : " ") : "";
        out += segment;
        afterWord = true;
      } else if (segment.trim()) {
        // Punctuation is already a pause; whitespace is replaced above.
        out += segment.trim() + " ";
        afterWord = false;
      }
    }
    return out.trim();
  };

  for (const input of [build(true), build(false)]) {
    if (Array.from(input).length <= TTS_MAX_CHARS) return input;
  }
  return null;
}
