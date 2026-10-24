import { describe, expect, it } from "vitest";
import { AUDIO_RATE, buildSessionConfig } from "../src/realtime/sessionConfig";

interface AudioConfig {
  input: {
    format: { type: string; rate: number };
    turn_detection: { type: string };
    transcription: { model: string; language?: string };
  };
  output: { format: { type: string; rate: number } };
}

function audioConfig(): AudioConfig {
  const event = buildSessionConfig();
  const session = event.session as { audio: AudioConfig };
  return session.audio;
}

describe("buildSessionConfig", () => {
  it("uses semantic VAD so learner pauses are not ended by a fixed silence window", () => {
    expect(audioConfig().input.turn_detection).toEqual({ type: "semantic_vad" });
  });

  it("keeps transcription language unset for code-switched speech", () => {
    expect(audioConfig().input.transcription).toEqual({ model: "higgs-stt-3.1" });
    expect(audioConfig().input.transcription).not.toHaveProperty("language");
  });

  it("keeps PCM16 audio at 24 kHz in both directions", () => {
    const audio = audioConfig();
    expect(AUDIO_RATE).toBe(24000);
    expect(audio.input.format).toEqual({ type: "audio/pcm", rate: AUDIO_RATE });
    expect(audio.output.format).toEqual({ type: "audio/pcm", rate: AUDIO_RATE });
  });
});
