/**
 * The assistant item that should be truncated when learner speech begins.
 *
 * `speech_started` also fires for a normal turn after playback has drained.
 * A remembered item id alone therefore does not mean the learner interrupted
 * it: truncating that stale item corrupts the conversation the model sees.
 */
export function interruptedAssistantItem(
  audioPlaying: boolean,
  currentItemId: string | null,
): string | null {
  return audioPlaying ? currentItemId : null;
}
