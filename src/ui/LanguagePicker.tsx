import {
  PROFILES,
  TARGET_LANGUAGE_CODES,
  type TargetLanguageCode,
} from "../lang/profiles";

export interface LanguagePickerProps {
  value: TargetLanguageCode;
  disabled?: boolean;
  onChange: (language: TargetLanguageCode) => void;
}

/** Selects the target profile used when the next realtime session starts. */
export function LanguagePicker({ value, disabled = false, onChange }: LanguagePickerProps) {
  return (
    <label className="language-picker">
      <span>Practice language</span>
      <select
        aria-label="Practice language"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value as TargetLanguageCode)}
      >
        {TARGET_LANGUAGE_CODES.map((code) => (
          <option key={code} value={code}>
            {PROFILES[code].name}
          </option>
        ))}
      </select>
    </label>
  );
}
