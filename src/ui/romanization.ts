import type { StudyState } from "../state/study";

export interface RomanizationEntry {
  text: string;
  romanization: string;
}

export interface RomanizedSegment {
  text: string;
  romanization?: string;
}

const HAN = /\p{Script=Han}/u;

/** Collect only tool-supplied romanizations that annotate Han text. */
export function romanizationsFromStudy(study: StudyState): RomanizationEntry[] {
  const candidates = [
    ...study.corrections.map((item) => ({
      text: item.correct,
      romanization: item.romanization,
    })),
    ...study.phrases.map((item) => ({
      text: item.phrase,
      romanization: item.romanization,
    })),
    ...study.pronunciationNotes.map((item) => ({
      text: item.target,
      romanization: item.romanization,
    })),
  ];

  const seen = new Set<string>();
  const entries: RomanizationEntry[] = [];
  for (const candidate of candidates) {
    const text = candidate.text.trim();
    const romanization = candidate.romanization?.trim();
    if (!text || !romanization || !HAN.test(text)) continue;

    const key = `${text}\u0000${romanization}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ text, romanization });
  }

  // Prefer a complete taught phrase when it contains a shorter taught word.
  return entries.sort((a, b) => b.text.length - a.text.length);
}

/** Split a transcript turn around exact phrases for which a tool supplied pinyin. */
export function annotateWithRomanization(
  text: string,
  entries: RomanizationEntry[],
): RomanizedSegment[] {
  if (!text || entries.length === 0) return text ? [{ text }] : [];

  const segments: RomanizedSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let match: RomanizationEntry | null = null;
    let matchAt = Number.POSITIVE_INFINITY;

    for (const entry of entries) {
      if (!entry.text) continue;
      const foundAt = text.indexOf(entry.text, cursor);
      if (
        foundAt >= 0 &&
        (foundAt < matchAt || (foundAt === matchAt && entry.text.length > (match?.text.length ?? 0)))
      ) {
        match = entry;
        matchAt = foundAt;
      }
    }

    if (!match) {
      segments.push({ text: text.slice(cursor) });
      break;
    }
    if (matchAt > cursor) segments.push({ text: text.slice(cursor, matchAt) });
    segments.push({ text: match.text, romanization: match.romanization });
    cursor = matchAt + match.text.length;
  }

  return segments;
}
