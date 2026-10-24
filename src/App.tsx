import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RealtimeClient,
  type Activity,
  type ConnectionState,
  type LogEntry,
} from "./realtime/RealtimeClient";
import {
  transcriptReducer,
  type TranscriptState,
} from "./state/transcriptStore";
import {
  studyFromTranscript,
  transcriptFromStudy,
  withoutStudyItems,
} from "./state/study";
import {
  clearStoredStudy,
  loadStoredStudy,
  saveStoredStudy,
} from "./state/studyStorage";
import {
  ACTIVE_PAIR,
  TARGET_LANGUAGE_CODES,
  learnerLevelFor,
  type LanguageCode,
  type TargetLanguageCode,
} from "./lang/profiles";
import { slowSpeechInput } from "./realtime/pace";
import { DebugDrawer } from "./ui/DebugDrawer";
import { MicButton } from "./ui/MicButton";
import { LanguagePicker } from "./ui/LanguagePicker";
import { PracticeBadge } from "./ui/PracticeBadge";
import {
  INITIAL_RECAP_VISIBILITY,
  SessionRecap,
  recapVisibilityAfterConnection,
} from "./ui/SessionRecap";
import { StatusBar } from "./ui/StatusBar";
import { StudyPanel } from "./ui/StudyPanel";
import { TranscriptPanel } from "./ui/TranscriptPanel";
import { playReplay, stopReplay } from "./ui/ttsReplay";

/**
 * "Say that again slowly": the tutor's line through /api/tts, slowed with
 * prosody tags. True once it is audible; false if it can't be built or
 * played, and the client then asks the model for the repeat instead.
 */
function playSlowRepeat(text: string): Promise<boolean> {
  const input = slowSpeechInput(text);
  if (!input) return Promise.resolve(false);
  return new Promise((resolve) => {
    // The first call wins: onStart means it played, settling first means not.
    playReplay(input, () => resolve(true)).then(
      () => resolve(false),
      () => resolve(false),
    );
  });
}

/** Ask our own server for a fresh ephemeral key. One per connection. */
async function fetchToken(): Promise<string> {
  const res = await fetch("/api/token");
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.value as string;
}

export default function App() {
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [activity, setActivity] = useState<Activity>("idle");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [closeMessage, setCloseMessage] = useState<string | null>(null);
  const [text, setText] = useState("Hi! Say something short so I can check my speakers.");
  const [transcript, setTranscript] = useState<TranscriptState>(() =>
    transcriptFromStudy(loadStoredStudy()),
  );
  const [micActive, setMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [recapVisibility, setRecapVisibility] = useState(INITIAL_RECAP_VISIBILITY);

  // A failed connection attempt is not a session. Remember that the socket
  // actually opened before treating a later close as the end of one.
  const handleConnectionState = useCallback((next: ConnectionState) => {
    setConnection(next);
    // Read the clock outside the updater, which StrictMode runs twice.
    const now = Date.now();
    setRecapVisibility((current) => recapVisibilityAfterConnection(current, next, now));
  }, []);

  // The client outlives re-renders, so it lives in a ref rather than state.
  const clientRef = useRef<RealtimeClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new RealtimeClient({
      tokenProvider: fetchToken,
      onConnectionState: handleConnectionState,
      onActivity: setActivity,
      onLog: (entry) => setLog((l) => [...l, entry]),
      onClose: (info) => setCloseMessage(info.message),
      onMicChange: setMicActive,
      onMicLevel: setMicLevel,
      slowRepeat: { play: playSlowRepeat, stop: stopReplay },
      // Every server event goes through the reducer. That is the whole wiring:
      // the client knows nothing about the transcript, and the transcript knows
      // nothing about sockets.
      onServerEvent: (evt) => {
        setTranscript((s) => transcriptReducer(s, evt, Date.now()));
      },
    });
  }

  useEffect(() => {
    const client = clientRef.current!;
    return () => void client.close();
  }, []);

  const study = useMemo(() => studyFromTranscript(transcript), [transcript]);
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguageCode>(() => {
    const stored = study.practiceLanguage?.language;
    return stored && isTargetLanguage(stored) ? stored : ACTIVE_PAIR.target;
  });
  // The stored level, restored from localStorage or set earlier this session.
  const storedLevel = study.practiceLanguage?.level;

  const connect = useCallback(async () => {
    setCloseMessage(null);
    await clientRef.current!.connect(learnerLevelFor(storedLevel), targetLanguage);
  }, [storedLevel, targetLanguage]);

  const send = useCallback(() => {
    if (!text.trim()) return;
    clientRef.current!.sendUserText(text);
  }, [text]);

  const toggleMic = useCallback(async () => {
    const client = clientRef.current!;
    setMicError(null);
    try {
      if (client.micActive) await client.stopMic();
      else await client.startMic();
    } catch (e) {
      // Denied permission, no input device, or an insecure origin. All three
      // land here and all three are worth telling the user about explicitly.
      setMicError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const isOpen = connection === "open";

  // A failed write is deliberately ignored so private browsing cannot break
  // the current session. Restored details live in the transcript as hidden
  // tool items, preserving the transcript as the UI's single source of truth.
  useEffect(() => {
    const hasStudyData =
      study.corrections.length > 0 ||
      study.phrases.length > 0 ||
      study.pronunciationNotes.length > 0 ||
      study.practiceLanguage !== null;
    if (!hasStudyData) return;
    saveStoredStudy(study);
  }, [study]);

  const clearStudy = useCallback(() => {
    clearStoredStudy();
    setTranscript((state) => withoutStudyItems(state));
  }, []);

  return (
    <main className="app">
      <h1>Higgs Realtime Tutorial</h1>
      <p className="lede">
        The finished app. Ask about something it could not know — the weekend
        weather in Willow Creek, say — and it will search for it and speak what
        it found.
      </p>

      <StatusBar connection={connection} activity={activity} closeMessage={closeMessage} />
      {recapVisibility.visible ? (
        <SessionRecap
          state={transcript}
          openedAt={recapVisibility.openedAt}
          onContinue={() =>
            setRecapVisibility((current) => ({ ...current, visible: false }))
          }
        />
      ) : (
        <>
          <PracticeBadge
            practice={
              study.practiceLanguage?.language === targetLanguage
                ? study.practiceLanguage
                : null
            }
            fallbackLanguage={targetLanguage}
          />

          <div className="row">
            <LanguagePicker
              value={targetLanguage}
              disabled={connection === "connecting" || isOpen}
              onChange={setTargetLanguage}
            />
            <button onClick={connect} disabled={connection === "connecting" || isOpen}>
              {connection === "connecting" ? "Connecting…" : "Connect"}
            </button>
            <button onClick={() => clientRef.current!.disconnect()} disabled={!isOpen}>
              Disconnect
            </button>
          </div>

          <MicButton
            active={micActive}
            level={micLevel}
            disabled={!isOpen}
            onToggle={toggleMic}
          />
          {micError && <p className="error">{micError}</p>}

          <details className="typed">
            <summary>…or type instead (Part 1's path, still here)</summary>
            <div className="row">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && isOpen && send()}
                placeholder="Type something for the model to say back…"
                disabled={!isOpen}
              />
              <button onClick={send} disabled={!isOpen}>
                Send
              </button>
            </div>
          </details>

          <div className="workspace">
            <TranscriptPanel state={transcript} />
            <StudyPanel state={transcript} onClear={clearStudy} />
          </div>
        </>
      )}

      <DebugDrawer entries={log} />
    </main>
  );
}

function isTargetLanguage(language: LanguageCode): language is TargetLanguageCode {
  return TARGET_LANGUAGE_CODES.some((code) => code === language);
}
