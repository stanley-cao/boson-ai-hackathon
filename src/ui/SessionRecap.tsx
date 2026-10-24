import { studyFromTranscript } from "../state/study";
import type { TranscriptState } from "../state/transcriptStore";
import type { ConnectionState } from "../realtime/RealtimeClient";

export interface RecapVisibility {
  sessionOpened: boolean;
  visible: boolean;
}

export const INITIAL_RECAP_VISIBILITY: RecapVisibility = {
  sessionOpened: false,
  visible: false,
};

/** Show a recap only after a real session, never after a failed connection. */
export function recapVisibilityAfterConnection(
  current: RecapVisibility,
  connection: ConnectionState,
): RecapVisibility {
  if (connection === "open") return { sessionOpened: true, visible: false };
  if (connection === "closed" && current.sessionOpened) {
    return { sessionOpened: false, visible: true };
  }
  return current;
}

export interface SessionRecapProps {
  state: TranscriptState;
  onContinue: () => void;
}

export function SessionRecap({ state, onContinue }: SessionRecapProps) {
  const study = studyFromTranscript(state);
  const corrections = [...study.corrections].reverse();
  const phrases = [...study.phrases].reverse();
  const total = corrections.length + phrases.length + study.pronunciationNotes.length;

  return (
    <section className="recap-screen" aria-labelledby="recap-heading">
      <div className="recap-intro">
        <span className="recap-kicker">Session complete</span>
        <h2 id="recap-heading">Here’s what you covered</h2>
        <p>
          {total === 0
            ? "No study notes were saved. Ask for corrections or phrases in your next session."
            : `You collected ${total} study ${total === 1 ? "note" : "notes"} to revisit.`}
        </p>
      </div>

      <ul className="recap-counts" aria-label="Session study counts">
        <RecapCount label="Corrections" count={corrections.length} />
        <RecapCount label="Phrases" count={phrases.length} />
        <RecapCount label="Pronunciation tips" count={study.pronunciationNotes.length} />
      </ul>

      <div className="recap-review">
        <section className="recap-section" aria-labelledby="recap-corrections-heading">
          <h3 id="recap-corrections-heading">Corrections to revisit</h3>
          {corrections.length === 0 ? (
            <p className="recap-empty">No corrections were saved this session.</p>
          ) : (
            <ul className="recap-list">
              {corrections.map((correction, index) => (
                <li
                  className="recap-item recap-item--correction"
                  key={`${correction.said}-${correction.correct}-${index}`}
                >
                  <span className="recap-label">You said</span>
                  <del>{correction.said}</del>
                  <span className="recap-label">Try instead</span>
                  <strong>{correction.correct}</strong>
                  {correction.romanization && (
                    <span className="romanization">{correction.romanization}</span>
                  )}
                  <p>{correction.explanation}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="recap-section" aria-labelledby="recap-phrases-heading">
          <h3 id="recap-phrases-heading">Phrases to review</h3>
          {phrases.length === 0 ? (
            <p className="recap-empty">No phrases were saved this session.</p>
          ) : (
            <ul className="recap-list">
              {phrases.map((phrase, index) => (
                <li
                  className="recap-item recap-item--phrase"
                  key={`${phrase.language}-${phrase.phrase}-${index}`}
                >
                  <span className="recap-language">{phrase.language.toUpperCase()}</span>
                  <strong>{phrase.phrase}</strong>
                  {phrase.romanization && (
                    <span className="romanization">{phrase.romanization}</span>
                  )}
                  <p>{phrase.meaning}</p>
                  {phrase.note && <p className="recap-note">{phrase.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <button className="recap-action" type="button" onClick={onContinue}>
        Back to conversation
      </button>
    </section>
  );
}

function RecapCount({ label, count }: { label: string; count: number }) {
  return (
    <li>
      <strong>{count}</strong>
      <span>{label}</span>
    </li>
  );
}
