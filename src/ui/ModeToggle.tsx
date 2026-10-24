export type SessionMode = "avatar" | "direct";

const MODE_KEY = "polyglot.mode";

/**
 * The remembered mode. Direct is the default: it needs only a Boson key,
 * while avatar mode also needs LiveKit Cloud and a running agent.
 */
export function loadStoredMode(): SessionMode {
  try {
    return localStorage.getItem(MODE_KEY) === "avatar" ? "avatar" : "direct";
  } catch {
    return "direct";
  }
}

export function saveStoredMode(mode: SessionMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private browsing: the choice just isn't remembered */
  }
}

const OPTIONS: { mode: SessionMode; label: string }[] = [
  { mode: "avatar", label: "Avatar" },
  { mode: "direct", label: "Voice only" },
];

/**
 * Avatar (LiveKit) or direct-WebSocket mode for the next session (#35).
 * Direct is the fallback when avatar capacity or latency is a problem.
 */
export function ModeToggle({
  value,
  disabled = false,
  onChange,
}: {
  value: SessionMode;
  disabled?: boolean;
  onChange: (mode: SessionMode) => void;
}) {
  return (
    <div className="mode-toggle" role="radiogroup" aria-label="Tutor mode">
      {OPTIONS.map(({ mode, label }) => (
        <button
          key={mode}
          role="radio"
          aria-checked={value === mode}
          className={value === mode ? "mode-on" : ""}
          disabled={disabled}
          onClick={() => onChange(mode)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
