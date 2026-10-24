import { ACTIVE_PAIR } from "../lang/profiles";
import type { LanguageCode, PracticeLanguage } from "../tools/types";

export interface PracticeLabel {
  language: LanguageCode;
  /** The language's name in its own script, e.g. "中文" for zh. */
  name: string;
  /** Unknown until the model calls set_practice_language. */
  level: PracticeLanguage["level"] | null;
}

// The language's own name ("中文", "한국어") reads better to a learner than
// "Mandarin Chinese", and Intl provides it for every code we might teach, so
// profiles don't need an extra field for it.
function nativeName(code: LanguageCode): string {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** What the badge shows: the latest set_practice_language, else the active target. */
export function practiceLabel(practice: PracticeLanguage | null): PracticeLabel {
  const language = practice?.language ?? ACTIVE_PAIR.target;
  return { language, name: nativeName(language), level: practice?.level ?? null };
}

export function PracticeBadge({ practice }: { practice: PracticeLanguage | null }) {
  const { language, name, level } = practiceLabel(practice);
  return (
    <div className="practice">
      <span className="practice-label">practising</span>
      <span className="practice-lang" lang={language}>
        {name}
      </span>
      {level && <span className="practice-level">{level}</span>}
    </div>
  );
}
