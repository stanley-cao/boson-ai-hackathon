import { describe, expect, it } from "vitest";
import {
  AUDIO_RATE,
  buildSessionConfig,
  buildTranscriptionDetectionReset,
  OUTPUT_VOICE,
} from "../src/realtime/sessionConfig";

interface AudioConfig {
  input: {
    format: { type: string; rate: number };
    turn_detection: { type: string; silence_duration_ms?: number };
    transcription: { model: string; language: string | null };
  };
  output: { format: { type: string; rate: number }; voice: string };
}

function audioConfig(): AudioConfig {
  const event = buildSessionConfig();
  const session = event.session as { audio: AudioConfig };
  return session.audio;
}

describe("buildSessionConfig", () => {
  it("waits out learner word-search pauses before ending a turn", () => {
    // #7: the 500 ms default, and semantic_vad at any window, cut a learner
    // pausing mid-sentence into two turns.
    expect(audioConfig().input.turn_detection).toEqual({
      type: "server_vad",
      silence_duration_ms: 1500,
    });
  });

  it("explicitly auto-detects the transcription language", () => {
    expect(audioConfig().input.transcription).toEqual({
      model: "higgs-stt-3.1",
      language: null,
    });
  });

  it("can reset language detection without changing the tutor configuration", () => {
    expect(buildTranscriptionDetectionReset()).toEqual({
      type: "session.update",
      session: {
        audio: {
          input: {
            transcription: { model: "higgs-stt-3.1", language: null },
          },
        },
      },
    });
  });

  it("keeps PCM16 audio at 24 kHz in both directions", () => {
    const audio = audioConfig();
    expect(AUDIO_RATE).toBe(24000);
    expect(audio.input.format).toEqual({ type: "audio/pcm", rate: AUDIO_RATE });
    expect(audio.output.format).toEqual({ type: "audio/pcm", rate: AUDIO_RATE });
  });

  it("uses the educational Eleanor preset for Mandarin practice", () => {
    expect(OUTPUT_VOICE).toBe("eleanor");
    expect(audioConfig().output.voice).toBe(OUTPUT_VOICE);
  });
});
