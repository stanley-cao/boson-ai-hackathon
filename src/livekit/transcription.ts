import { SERVER, type ServerEvent } from "../realtime/events";
import type { Activity } from "../realtime/RealtimeClient";

/**
 * Transcripts in LiveKit mode (#35).
 *
 * The agent owns the Higgs Realtime session there, so no Realtime events reach
 * the browser. LiveKit Agents publishes both sides of the conversation as text
 * streams on `lk.transcription` instead: the learner's lines with the learner
 * as sender, the tutor's with the agent as sender. We turn each stream into the
 * Realtime events the transcript reducer already understands, so the
 * transcript stays the one source of truth and every view works unchanged.
 */
export const TRANSCRIPTION_TOPIC = "lk.transcription";
// Stream attributes set by LiveKit Agents.
const SEGMENT_ID = "lk.segment_id";
const FINAL = "lk.transcription_final";
// The agent's state, as a participant attribute on the agent.
export const AGENT_STATE_ATTRIBUTE = "lk.agent.state";

/** The part of livekit-client's TextStreamReader this needs. */
export interface TranscriptionStream extends AsyncIterable<string> {
  info: { id: string; attributes?: Record<string, string> };
}

/** Segments get their own id space so they never collide with tool items. */
function itemId(stream: TranscriptionStream): string {
  return `lk-${stream.info.attributes?.[SEGMENT_ID] ?? stream.info.id}`;
}

function isFinal(stream: TranscriptionStream): boolean {
  return stream.info.attributes?.[FINAL] === "true";
}

/**
 * Feed one transcription stream into the transcript.
 *
 * Learner: each stream carries a whole interim or final transcript of a
 * segment. The first creates the pending bubble — through speech_started, so
 * a tutor turn still streaming is marked interrupted, as on barge-in — and the
 * final one fills it in.
 *
 * Tutor: text arrives as deltas while it is spoken, and the stream closes when
 * the turn ends. A stream marked final carries the whole text instead, which
 * the reducer prefers over joined deltas (e.g. a line cut short by barge-in).
 * Never throws: a stream that breaks off still ends the turn.
 */
export async function readTranscription(
  stream: TranscriptionStream,
  fromLearner: boolean,
  onServerEvent: (evt: ServerEvent) => void,
): Promise<void> {
  const item_id = itemId(stream);
  let text = "";
  try {
    for await (const chunk of stream) {
      text += chunk;
      if (!fromLearner && !isFinal(stream)) {
        onServerEvent({ type: SERVER.audioTranscriptDelta, item_id, delta: chunk });
      }
    }
  } catch {
    /* the sender left mid-stream; keep what arrived */
  }

  if (fromLearner) {
    onServerEvent({ type: SERVER.speechStarted, item_id });
    if (isFinal(stream)) onServerEvent({ type: SERVER.transcriptionCompleted, item_id, transcript: text });
    return;
  }
  if (isFinal(stream)) {
    // An empty delta creates the turn if no delta stream came first.
    onServerEvent({ type: SERVER.audioTranscriptDelta, item_id, delta: "" });
    onServerEvent({ type: SERVER.audioTranscriptDone, item_id, transcript: text });
  } else {
    onServerEvent({ type: SERVER.audioTranscriptDone, item_id });
  }
}

/**
 * The tutor's new activity from a participant-attributes change, or null.
 *
 * Only the tutor agent counts: the Higgs Avatar is a participant too, and an
 * `lk.agent.state` from it would flip the status bar between the two.
 */
export function tutorActivityFrom(
  changed: Record<string, string>,
  participantIdentity: string | undefined,
  agentIdentity: string,
): Activity | null {
  if (participantIdentity !== agentIdentity || !(AGENT_STATE_ATTRIBUTE in changed)) return null;
  return activityFromAgentState(changed[AGENT_STATE_ATTRIBUTE]);
}

/** The agent's `lk.agent.state` as the status bar's activity. */
export function activityFromAgentState(state: string | undefined): Activity {
  switch (state) {
    case "listening":
    case "thinking":
    case "speaking":
      return state;
    default:
      // "initializing", "idle", or no agent yet.
      return "idle";
  }
}
