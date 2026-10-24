import type { SessionActivity } from "../quiz/session";

export function ActivityToggle({
  value,
  disabled = false,
  onChange,
}: {
  value: SessionActivity;
  disabled?: boolean;
  onChange: (activity: SessionActivity) => void;
}) {
  return (
    <div className="mode-toggle" role="radiogroup" aria-label="Session activity">
      {(["conversation", "quiz"] as const).map((activity) => (
        <button
          key={activity}
          role="radio"
          aria-checked={value === activity}
          className={value === activity ? "mode-on" : ""}
          disabled={disabled}
          onClick={() => onChange(activity)}
        >
          {activity === "conversation" ? "Conversation" : "Quiz"}
        </button>
      ))}
    </div>
  );
}
