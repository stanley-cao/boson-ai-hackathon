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


def learner_level_for(level: object) -> str:
    """The prompt level for a stated level, as learnerLevelFor in src/lang/profiles.ts.

    prompts.json has beginner and intermediate prompts; advanced shares the
    intermediate one, and anything else falls back to beginner.
    """
    return "intermediate" if level in ("intermediate", "advanced") else "beginner"


def prompt_for(language: object, level: object, prompts: dict[str, dict[str, str]]) -> str | None:
    """The prompt for a language and stated level, or None for an unknown language."""
    return prompts.get(str(language), {}).get(learner_level_for(level))


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
    return prompt_for(choice.get("language"), choice.get("level"), prompts) or default


def practice_change(name: str, result: dict[str, Any], prompts: dict[str, dict[str, str]]) -> str | None:
    """The new prompt a tool result calls for, as practiceChangeFromTool in sessionConfig.ts.

    Only a successful ``set_practice_language`` does. Its result is the browser's
    ToolResult, so the detail's shape is checked rather than trusted.
    """
    if name != "set_practice_language":
        return None
    detail = result.get("detail")
    if not isinstance(detail, dict) or detail.get("type") != "practice_language":
        return None
    return prompt_for(detail.get("language"), detail.get("level"), prompts)


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
        # The raw dict rather than the plugin's model/language kwargs: those
        # drop a None language, and Boson needs the explicit JSON null to
        # auto-detect code-switched speech.
        "input_audio_transcription": auto_detect_transcription(session),
    }


def auto_detect_transcription(session: dict[str, Any]) -> dict[str, Any]:
    """The transcription config that asks Boson to detect the spoken language.

    Boson lets STT follow the conversation language after the first reply, so a
    Serbian tutor turns the learner's English captions into Serbian. The agent
    resends this as each turn starts, as RealtimeClient.ts does in direct mode.
    """
    return {"model": session["audio"]["input"]["transcription"]["model"], "language": None}
