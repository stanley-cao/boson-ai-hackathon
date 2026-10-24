import { useEffect, useRef } from "react";
import { segmentByScript } from "../lang/scriptRuns";
import { studyFromTranscript } from "../state/study";
import {
  toDisplayList,
  toPlainText,
  type TranscriptItem,
  type TranscriptState,
} from "../state/transcriptStore";
import {
  annotateWithRomanization,
  romanizationsFromStudy,
  type RomanizationEntry,
} from "./romanization";

export function TranscriptPanel({ state }: { state: TranscriptState }) {
  const items = toDisplayList(state);
  const romanizations = romanizationsFromStudy(studyFromTranscript(state));
  const scrollRef = useRef<HTMLDivElement>(null);
  const followsConversationRef = useRef(true);
  const previousItemCountRef = useRef(0);

  // Keep motion inside the transcript. scrollIntoView() also moves the page,
  // which made a new learner/assistant turn jump the whole UI. Only follow
  // while the reader is already near the latest message; scrolling up to read
  // an older turn opts out until they return to the bottom.
  useEffect(() => {
    const panel = scrollRef.current;
    const isNewTurn = items.length > previousItemCountRef.current;
    previousItemCountRef.current = items.length;
    if (!panel || !followsConversationRef.current) return;

    const frame = requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      panel.scrollTo({
        top: panel.scrollHeight,
        // Ease between bubbles, but do not restart a smooth animation for
        // every streaming transcript delta inside the same bubble.
        behavior: isNewTurn && !reduceMotion ? "smooth" : "auto",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [items.length, items[items.length - 1]]);

  if (items.length === 0) {
    return <p className="empty">Start the microphone and say something.</p>;
  }

  return (
    <section className="transcript-panel">
      <div className="transcript-head">
        <span>Transcript</span>
        <button
          className="link"
          onClick={() => void navigator.clipboard.writeText(toPlainText(state))}
        >
          copy
        </button>
      </div>
      <div
        className="transcript-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          followsConversationRef.current = isNearTranscriptBottom(event.currentTarget);
        }}
      >
        {items.map((item) => (
          <TurnBubble key={item.itemId} item={item} romanizations={romanizations} />
        ))}
      </div>
    </section>
  );
}

/** Whether auto-following would preserve, rather than override, reading position. */
export function isNearTranscriptBottom(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  threshold = 96,
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function TurnBubble({
  item,
  romanizations,
}: {
  item: TranscriptItem;
  romanizations: RomanizationEntry[];
}) {
  if (item.kind === "system") {
    return <div className="turn system">— {item.text} —</div>;
  }

  if (item.kind === "tool") {
    const summary =
      item.result && typeof item.result === "object" && "summary" in item.result
        ? String((item.result as { summary: unknown }).summary)
        : null;
    return (
      <div className={`turn tool ${item.status}`}>
        <span className="who">
          {item.name}
          {item.ms != null && <span className="ms"> {item.ms}ms</span>}
        </span>
        <code className="args">{item.args ? JSON.stringify(item.args) : "…"}</code>
        {item.status === "running" && <span className="pending"> running…</span>}
        {summary && <div className="tool-result">{summary}</div>}
      </div>
    );
  }

  if (item.kind === "user") {
    return (
      <div className="turn user">
        <span className="who">you</span>
        {/* text is null until the transcription arrives — which is seconds
            after the words were spoken. Showing the placeholder is what makes
            the UI feel responsive rather than broken. */}
        {item.text === null ? (
          <span className="pending">transcribing…</span>
        ) : (
          // dir="auto" so Arabic, Hebrew, Persian or Urdu reads right to left.
          <span dir="auto">
            <ScriptText text={item.text} romanizations={romanizations} />
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`turn assistant ${item.status}`}>
      <span className="who">assistant</span>
      <span dir="auto">
        <ScriptText text={item.text} romanizations={romanizations} />
      </span>
      {item.status === "streaming" && <span className="caret" />}
      {item.status === "interrupted" && <span className="badge">interrupted</span>}
    </div>
  );
}

function ScriptText({
  text,
  romanizations,
}: {
  text: string;
  romanizations: RomanizationEntry[];
}) {
  return annotateWithRomanization(text, romanizations).map((segment, segmentIndex) => {
    if (segment.romanization) {
      return (
        <span className="romanized-text" key={`romanized-${segmentIndex}`}>
          <span className="script-han">{segment.text}</span>
          <span className="transcript-romanization">{segment.romanization}</span>
        </span>
      );
    }

    return segmentByScript(segment.text).map((run, runIndex) => (
      <span
        className={`script-${run.script}`}
        key={`${segmentIndex}-${runIndex}-${run.script}`}
      >
        {run.text}
      </span>
    ));
  });
}
