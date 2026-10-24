"""The browser's session config, as exported by `npm run export-config`.

shared/session.json is the `session` object of buildSessionConfig() in
src/realtime/sessionConfig.ts. Reading it here means the LiveKit agent runs
with exactly the browser's prompt, voice, turn detection and transcription,
and changing them stays a TypeScript change (ROADMAP shared contract 4).
"""

import json
import re
from pathlib import Path
from typing import Any

SHARED = Path(__file__).resolve().parent.parent / "shared"
SESSION_JSON = SHARED / "session.json"
# Every target language's prompt at every level, keyed [language][level].
PROMPTS_JSON = SHARED / "prompts.json"
# {"slow_note": ..., "slower_note": ...}: the sentence each slow pace appends to any prompt.
PACE_JSON = SHARED / "pace.json"


def load_session(path: Path = SESSION_JSON) -> dict[str, Any]:
    """Read the exported session. Raises if it is missing: run `npm run export-config`."""
    return json.loads(path.read_text(encoding="utf-8"))


def load_prompts(path: Path = PROMPTS_JSON) -> dict[str, dict[str, str]]:
    """Read the exported prompts. Raises if missing: run `npm run export-config`."""
    return json.loads(path.read_text(encoding="utf-8"))


def load_slow_note(path: Path = PACE_JSON) -> str:
    """Read the slow-pace sentence. Raises if missing: run `npm run export-config`."""
    return json.loads(path.read_text(encoding="utf-8"))["slow_note"]


def load_pace_notes(path: Path = PACE_JSON) -> dict[str, str]:
    """{pace: sentence} for the slow paces, as PACE_NOTES in sessionConfig.ts."""
    pace = json.loads(path.read_text(encoding="utf-8"))
    return {"slow": pace["slow_note"], "slower": pace["slower_note"]}


def with_pace(prompt: str, pace: str, notes: dict[str, str]) -> str:
    """The prompt at a pace, as buildTutorPrompt appends the pace's note last."""
    note = notes.get(pace)
    return f"{prompt} {note}" if note else prompt


PACE_ORDER = ["normal", "slow", "slower"]


def slower_than(pace: str) -> str:
    """The next pace down, as slowerThan in handlers.ts."""
    return "slow" if pace == "normal" else "slower"


def one_off_pace(requested: str, just_heard: str) -> str:
    """A one-off slow repeat's pace, as oneOffPace in handlers.ts.

    Asked for again when the line was already slow, it goes one step slower,
    or the repeat would sound the same.
    """
    step = slower_than(just_heard)
    return requested if PACE_ORDER.index(requested) > PACE_ORDER.index(step) else step


def session_pace_for(requested: str, current: str) -> str:
    """A lasting pace change, as planPaceChange: slow while already slow is slower."""
    return "slower" if requested == "slow" and current != "normal" else requested


def slow_repeat_summary(text: str) -> str:
    """What to say for "say that slowly" right after a study item, as slowRepeatSummary."""
    return f"Now say {text} again, slowly, syllable by syllable with a short pause after each. Add nothing new."


def practice_focus(result: dict[str, Any]) -> str | None:
    """The line a study tool's result centres the next reply on, as practiceFocusFromTool."""
    detail = result.get("detail")
    if not isinstance(detail, dict):
        return None
    key = {"correction": "correct", "phrase": "phrase", "pronunciation": "target"}.get(str(detail.get("type")))
    text = detail.get(key) if key else None
    return text.strip() if isinstance(text, str) and text.strip() else None


def pace_request(arguments: dict[str, Any]) -> tuple[str, str]:
    """(pace, scope) from set_speaking_pace arguments, as paceRequestFrom in handlers.ts.

    Anything unrecognised is a one-off slow repeat, the cheapest wrong guess;
    "normal" always applies to the rest of the session.
    """
    raw = str(arguments.get("pace", ""))
    if re.search(r"normal|fast|quick|natural|regular", raw, re.I):
        pace = "normal"
    elif re.search(r"slower|slowest|very|extra|even|more", raw, re.I):
        pace = "slower"
    else:
        pace = "slow"
    if pace == "normal" or re.search(r"session|always|rest", str(arguments.get("scope", "")), re.I):
        return pace, "session"
    return pace, "once"


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


def practice_choice(metadata: str, prompts: dict[str, dict[str, str]]) -> tuple[str, str]:
    """(language, level) from the learner's token metadata, as instructions_for reads it.

    Falls back to the default pair, zh at beginner, which is the prompt
    instructions_for falls back to as well.
    """
    try:
        choice = json.loads(metadata) if metadata else {}
    except json.JSONDecodeError:
        choice = {}
    if not isinstance(choice, dict) or str(choice.get("language")) not in prompts:
        return "zh", "beginner"
    return str(choice["language"]), str(choice.get("level") or "beginner")


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
        # The raw dict, passed through whole, so the exported language hint
        # (#107: the native language) reaches the server exactly as the
        # browser sends it, including an explicit null if it is ever unset.
        "input_audio_transcription": turn_transcription(session),
    }


def turn_transcription(session: dict[str, Any]) -> dict[str, Any]:
    """The transcription config to resend as each turn starts.

    Boson lets STT follow the conversation language after the first reply, so a
    Serbian tutor turned the learner's English captions into Serbian. The agent
    resends the exported config (model and language hint) every turn, as
    buildTranscriptionDetectionReset does in RealtimeClient.ts.
    """
    return dict(session["audio"]["input"]["transcription"])
