"""The browser's session config, as exported by `npm run export-config`.

shared/session.json is the `session` object of buildSessionConfig() in
src/realtime/sessionConfig.ts. Reading it here means the LiveKit agent runs
with exactly the browser's prompt, voice, turn detection and transcription,
and changing them stays a TypeScript change (ROADMAP shared contract 4).
"""

import json
from pathlib import Path
from typing import Any

SESSION_JSON = Path(__file__).resolve().parent.parent / "shared" / "session.json"


def load_session(path: Path = SESSION_JSON) -> dict[str, Any]:
    """Read the exported session. Raises if it is missing: run `npm run export-config`."""
    return json.loads(path.read_text(encoding="utf-8"))


def model_kwargs(session: dict[str, Any]) -> dict[str, Any]:
    """Map the exported session onto boson.realtime.RealtimeModel's keyword arguments.

    Tools are not here: LiveKit registers them on the Agent (see tools.py).
    """
    audio_in = session["audio"]["input"]
    return {
        "model": session["model"],
        "instructions": session["instructions"],
        "voice": session["audio"]["output"]["voice"],
        "output_modalities": session["output_modalities"],
        # Passed through whole: the 1.5 s silence window lets learners pause
        # mid-sentence (#7), and the plugin's own default is 500 ms.
        "turn_detection": audio_in["turn_detection"],
        # The plugin only emits user transcripts when a model is named. The
        # language is deliberately left unset, so code-switched speech is
        # auto-detected; the plugin adds none of its own when it is None.
        "input_audio_transcription_model": audio_in["transcription"]["model"],
        "input_audio_transcription_language": audio_in["transcription"].get("language"),
    }
