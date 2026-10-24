"""The browser's session config, as exported by `npm run export-config`.

shared/session.json is the `session` object of buildSessionConfig() in
src/realtime/sessionConfig.ts. Reading it here means the LiveKit agent runs
with exactly the browser's prompt, voice, turn detection and transcription,
and changing them stays a TypeScript change (ROADMAP shared contract 4).
"""

import json
from pathlib import Path
from typing import Any

SHARED = Path(__file__).resolve().parent.parent / "shared"
SESSION_JSON = SHARED / "session.json"
# Every target language's prompt at every level, keyed [language][level].
PROMPTS_JSON = SHARED / "prompts.json"


def load_session(path: Path = SESSION_JSON) -> dict[str, Any]:
    """Read the exported session. Raises if it is missing: run `npm run export-config`."""
    return json.loads(path.read_text(encoding="utf-8"))


def load_prompts(path: Path = PROMPTS_JSON) -> dict[str, dict[str, str]]:
    """Read the exported prompts. Raises if missing: run `npm run export-config`."""
    return json.loads(path.read_text(encoding="utf-8"))


def instructions_for(metadata: str, prompts: dict[str, dict[str, str]], default: str) -> str:
    """The prompt for the language and level in the learner's token metadata.

    server/avatar.ts writes ``{"language": "ko", "level": "beginner"}`` there.
    A participant without it (Agents Playground, probe.py) or with an unknown
    pair gets ``default``, the exported session's prompt, rather than an error.
    """
    try:
        choice = json.loads(metadata) if metadata else {}
    except json.JSONDecodeError:
        return default
    if not isinstance(choice, dict):
        return default
    by_level = prompts.get(str(choice.get("language")), {})
    return by_level.get(str(choice.get("level")), default)


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
        # native-language hint stabilizes short ambiguous English turns while
        # still allowing the realtime model to detect clear language switches.
        "input_audio_transcription_model": audio_in["transcription"]["model"],
        "input_audio_transcription_language": audio_in["transcription"].get("language"),
    }
