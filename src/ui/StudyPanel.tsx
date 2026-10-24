import { useState, type ReactNode } from "react";
import { studyFromTranscript } from "../state/study";
import type { TranscriptState } from "../state/transcriptStore";
import type { Correction, Phrase, PronunciationNote } from "../tools/types";
import { playReplay, REPLAY_MESSAGES, ReplayError } from "./ttsReplay";

export interface StudyPanelProps {
  state: TranscriptState;
  onClear?: () => void;
}

export function StudyPanel({ state, onClear }: StudyPanelProps) {
  const study = studyFromTranscript(state);
  const corrections = [...study.corrections].reverse();
  const phrases = [...study.phrases].reverse();
  const pronunciationNotes = [...study.pronunciationNotes].reverse();
  const itemCount = corrections.length + phrases.length + pronunciationNotes.length;
  const hasItems = itemCount > 0;
  const canClear = hasItems || study.practiceLanguage !== null;

  return (
    <aside className="study-panel" aria-labelledby="study-heading">
      <div className="study-head">
        <h2 id="study-heading">Study notes</h2>
        {canClear && (
          <div className="study-head-actions">
            {hasItems && <span>{itemCount}</span>}
            {onClear && (
              <button className="link" type="button" onClick={onClear}>
                clear
              </button>
            )}
          </div>
        )}
      </div>

      {!hasItems && (
        <p className="study-empty">
          Nothing saved yet. Corrections, useful phrases, and pronunciation tips will appear here.
        </p>
      )}

      {corrections.length > 0 && (
        <StudyGroup title="Corrections" count={corrections.length}>
          {corrections.map((correction, index) => (
            <CorrectionCard key={`${correction.said}-${correction.correct}-${index}`} item={correction} />
          ))}
        </StudyGroup>
      )}

      {phrases.length > 0 && (
        <StudyGroup title="Saved phrases" count={phrases.length}>
          {phrases.map((phrase, index) => (
            <PhraseCard key={`${phrase.language}-${phrase.phrase}-${index}`} item={phrase} />
          ))}
        </StudyGroup>
      )}

      {pronunciationNotes.length > 0 && (
        <StudyGroup title="Pronunciation" count={pronunciationNotes.length}>
          {pronunciationNotes.map((note, index) => (
            <PronunciationCard key={`${note.target}-${note.issue}-${index}`} item={note} />
          ))}
        </StudyGroup>
      )}
    </aside>
  );
}

function StudyGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="study-group">
      <h3>
        {title} <span>{count}</span>
      </h3>
      <div className="study-cards">{children}</div>
    </section>
  );
}

function CardMeta({ language, label }: { language: string; label: string }) {
  return (
    <div className="study-card-meta">
      <span>{label}</span>
      <span>{language.toUpperCase()}</span>
    </div>
  );
}

type ReplayStatus = "idle" | "loading" | "playing" | "error";

// Button state is transient UI, not study data, so it lives here rather than in
// the transcript reducer.
function ReplayButton({ text }: { text: string }) {
  const [status, setStatus] = useState<ReplayStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function replay() {
    setStatus("loading");
    setError(null);
    try {
      await playReplay(text, () => setStatus("playing"));
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err instanceof ReplayError ? err.message : REPLAY_MESSAGES.generic);
    }
  }

  const busy = status === "loading" || status === "playing";
  return (
    <div className="study-card-actions">
      <button
        className="replay-button"
        type="button"
        onClick={replay}
        disabled={busy}
        aria-busy={status === "loading"}
        aria-label={`Replay ${text}`}
      >
        <span aria-hidden="true">▶</span>{" "}
        {status === "loading" ? "Loading…" : status === "playing" ? "Playing…" : "Replay"}
      </button>
      {error && (
        <span className="replay-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function CorrectionCard({ item }: { item: Correction }) {
  return (
    <article className="study-card study-card--correction">
      <CardMeta language={item.language} label={item.kind} />
      <div className="correction-pair">
        <div>
          <span className="study-label">You said</span>
          <del>{item.said}</del>
        </div>
        <div>
          <span className="study-label">Try instead</span>
          <strong>{item.correct}</strong>
          {item.romanization && <span className="romanization">{item.romanization}</span>}
        </div>
      </div>
      <p>{item.explanation}</p>
      <ReplayButton text={item.correct} />
    </article>
  );
}

function PhraseCard({ item }: { item: Phrase }) {
  return (
    <article className="study-card study-card--phrase">
      <CardMeta language={item.language} label="phrase" />
      <strong className="study-target">{item.phrase}</strong>
      {item.romanization && <span className="romanization">{item.romanization}</span>}
      <p className="study-meaning">{item.meaning}</p>
      {item.note && <p className="study-note">{item.note}</p>}
      <ReplayButton text={item.phrase} />
    </article>
  );
}

function PronunciationCard({ item }: { item: PronunciationNote }) {
  return (
    <article className="study-card study-card--pronunciation">
      <CardMeta language={item.language} label={item.issue} />
      <strong className="study-target">{item.target}</strong>
      {item.romanization && <span className="romanization">{item.romanization}</span>}
      <p>{item.tip}</p>
      <ReplayButton text={item.target} />
    </article>
  );
}
