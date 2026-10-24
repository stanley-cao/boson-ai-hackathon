import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RemoteVideoTrack } from "livekit-client";
import { AvatarSession, AvatarUnavailableError } from "./livekit/AvatarSession";
import {
  RealtimeClient,
  type Activity,
  type ConnectionState,
  type LogEntry,
} from "./realtime/RealtimeClient";
import type { ServerEvent } from "./realtime/events";
import {
  transcriptReducer,
  type TranscriptState,
} from "./state/transcriptStore";
import {
  freshSessionTranscript,
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
import { slowSpeechChunks, type SlowSpeechOptions } from "./realtime/pace";
import { AvatarStage } from "./ui/AvatarStage";
import { DebugDrawer } from "./ui/DebugDrawer";
import { MicButton } from "./ui/MicButton";
import { LanguagePicker } from "./ui/LanguagePicker";
import { ModeToggle, loadStoredMode, saveStoredMode, type SessionMode } from "./ui/ModeToggle";
import { PracticeBadge } from "./ui/PracticeBadge";
import {
  INITIAL_RECAP_VISIBILITY,
  SessionRecap,
  recapVisibilityAfterConnection,
} from "./ui/SessionRecap";
import { StatusBar } from "./ui/StatusBar";
import { StudyPanel } from "./ui/StudyPanel";
import { TranscriptPanel } from "./ui/TranscriptPanel";
import { playReplaySequence, stopReplay } from "./ui/ttsReplay";

/**
 * "Say that again slowly": the tutor's line through /api/tts, slowed with
 * prosody tags. True once it is audible; false if it can't be built or
 * played, and the client then asks the model for the repeat instead.
 */
function playSlowRepeat(text: string, options: SlowSpeechOptions): Promise<boolean> {
  // In parts when the line is too long for one /api/tts request.
  const inputs = slowSpeechChunks(text, options);
  if (!inputs) return Promise.resolve(false);
  return new Promise((resolve) => {
    // The first call wins: onStart means it played, settling first means not.
    playReplaySequence(inputs, () => resolve(true)).then(
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
  const [mode, setMode] = useState<SessionMode>(loadStoredMode);
  const [avatarVideo, setAvatarVideo] = useState<RemoteVideoTrack | null>(null);

  // A failed connection attempt is not a session. Remember that the socket
  // actually opened before treating a later close as the end of one.
  const handleConnectionState = useCallback((next: ConnectionState) => {
    setConnection(next);
    // Read the clock outside the updater, which StrictMode runs twice.
    const now = Date.now();
    setRecapVisibility((current) => recapVisibilityAfterConnection(current, next, now));
  }, []);

  // The clients outlive re-renders, so they live in refs rather than state.
  const clientRef = useRef<RealtimeClient | null>(null);
  const avatarRef = useRef<AvatarSession | null>(null);
  if (!clientRef.current || !avatarRef.current) {
    // Both modes report through the same callbacks, so everything below is
    // the same whichever one is connected.
    const callbacks = {
      onConnectionState: handleConnectionState,
      onActivity: setActivity,
      onLog: (entry: LogEntry) => setLog((l) => [...l, entry]),
      onClose: (info: { message: string }) => setCloseMessage(info.message),
      onMicChange: setMicActive,
      onMicLevel: setMicLevel,
      // Every server event goes through the reducer. That is the whole wiring:
      // the client knows nothing about the transcript, and the transcript knows
      // nothing about sockets.
      onServerEvent: (evt: ServerEvent) => {
        setTranscript((s) => transcriptReducer(s, evt, Date.now()));
      },
    };
    clientRef.current = new RealtimeClient({
      ...callbacks,
      tokenProvider: fetchToken,
      slowRepeat: { play: playSlowRepeat, stop: stopReplay },
    });
    avatarRef.current = new AvatarSession({ ...callbacks, onVideo: setAvatarVideo });
  }

  useEffect(() => {
    const client = clientRef.current!;
    const avatar = avatarRef.current!;
    return () => {
      void client.close();
      void avatar.close();
    };
  }, []);

  /** Whichever client the current mode uses. */
  const session = useCallback(
    () => (mode === "avatar" ? avatarRef.current! : clientRef.current!),
    [mode],
  );

  const changeMode = useCallback((next: SessionMode) => {
    setMode(next);
    saveStoredMode(next);
  }, []);

  const study = useMemo(() => studyFromTranscript(transcript), [transcript]);
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguageCode>(() => {
    const stored = study.practiceLanguage?.language;
    return stored && isTargetLanguage(stored) ? stored : ACTIVE_PAIR.target;
  });
  // A spoken switch ("let's do French") reaches the transcript through
  // set_practice_language; follow it so the badge and the next session match.
  const practisedLanguage = study.practiceLanguage?.language;
  useEffect(() => {
    if (practisedLanguage && isTargetLanguage(practisedLanguage)) setTargetLanguage(practisedLanguage);
  }, [practisedLanguage]);
  // The stored level, restored from localStorage or set earlier this session.
  const storedLevel = study.practiceLanguage?.level;

  const connect = useCallback(async () => {
    setCloseMessage(null);
    // Each session starts with a clean chat; saved study items stay.
    setTranscript((s) => freshSessionTranscript(s));
    if (mode === "direct") {
      await clientRef.current!.connect(learnerLevelFor(storedLevel), targetLanguage);
      return;
    }
    try {
      await avatarRef.current!.connect(targetLanguage, learnerLevelFor(storedLevel));
    } catch (e) {
      // The fallback (#35): no capacity, no LiveKit, or no room. Not saved, so
      // the next visit tries the avatar again.
      const code = e instanceof AvatarUnavailableError ? e.code : String(e);
      setMode("direct");
      setCloseMessage(
        code === "agent_not_running"
          ? "The avatar's tutor agent isn't running (start it with `npm run dev:agent`). Switched to voice only: press Connect."
          : `Avatar unavailable (${code}). Switched to voice only: press Connect.`,
      );
    }
  }, [mode, storedLevel, targetLanguage]);

  const send = useCallback(() => {
    if (!text.trim()) return;
    session().sendUserText(text);
  }, [session, text]);

  const toggleMic = useCallback(async () => {
    const client = session();
    setMicError(null);
    try {
      if (client.micActive) await client.stopMic();
      else await client.startMic();
    } catch (e) {
      // Denied permission, no input device, or an insecure origin. All three
      // land here and all three are worth telling the user about explicitly.
      setMicError(e instanceof Error ? e.message : String(e));
    }
  }, [session]);

  const isOpen = connection === "open";
  const busy = connection === "connecting" || isOpen;
  // Both modes start the session in the picked language: avatar mode passes
  // it to the agent through the room token.
  const sessionLanguage = targetLanguage;

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
      <header className="app-header">
        <a className="brand" href="#top" aria-label="Polyglot home">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>
            <strong>Polyglot</strong>
            <small>Powered by Boson</small>
          </span>
        </a>
        <StatusBar connection={connection} activity={activity} closeMessage={closeMessage} />
      </header>

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
          <section className="hero" id="top">
            <div className="hero-copy">
              <span className="eyebrow">Speak naturally · learn continuously</span>
              <h1>Your conversation partner,<br /><em>for your next language.</em></h1>
              <p className="lede">
                Practise real conversations, switch languages mid-sentence, and turn every
                correction into something worth remembering.
              </p>
              <PracticeBadge
                practice={
                  study.practiceLanguage?.language === sessionLanguage
                    ? study.practiceLanguage
                    : null
                }
                fallbackLanguage={sessionLanguage}
              />
            </div>

            <div className="session-card">
              <div className="session-card-head">
                <div>
                  <span className="section-kicker">New conversation</span>
                  <h2>Ready when you are</h2>
                </div>
                <span className={`session-orb session-orb--${connection}`} aria-hidden="true" />
              </div>

              <div className="session-options">
                <LanguagePicker
                  value={sessionLanguage}
                  disabled={busy}
                  onChange={setTargetLanguage}
                />
                <div className="mode-field">
                  <span>Experience</span>
                  <ModeToggle value={mode} disabled={busy} onChange={changeMode} />
                </div>
              </div>

              <div className="connection-actions">
                <button className="primary-action" onClick={connect} disabled={busy}>
                  {connection === "connecting" ? "Joining your tutor…" : "Start a session"}
                </button>
                {/* Avatar mode can be left while it connects; RealtimeClient
                    can't yet cancel before its socket exists. */}
                <button
                  className="secondary-action"
                  onClick={() => session().disconnect()}
                  disabled={!(isOpen || (mode === "avatar" && connection === "connecting"))}
                >
                  End
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
                <summary>Prefer typing?</summary>
                <div className="row typed-row">
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && isOpen && send()}
                    placeholder="Write a message to your tutor…"
                    disabled={!isOpen}
                  />
                  <button className="send-button" onClick={send} disabled={!isOpen}>
                    Send
                  </button>
                </div>
              </details>
            </div>
          </section>

          <div className={mode === "avatar" ? "workspace workspace--avatar" : "workspace"}>
            {mode === "avatar" && <AvatarStage track={avatarVideo} connection={connection} />}
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
