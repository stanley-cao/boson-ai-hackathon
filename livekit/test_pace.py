"""Unit tests for avatar-mode speaking pace. No network, no keys."""

import asyncio
from typing import Any

from agent import PROMPTS, SLOW_NOTE, Tutor
from session_config import pace_request, with_pace

SERBIAN = PROMPTS["sr"]["beginner"]


def call(tutor: Tutor, name: str, arguments: dict[str, Any], result: dict[str, Any]) -> None:
    asyncio.run(tutor.after_tool(name, arguments, result, None))  # type: ignore[arg-type]


def pace(tutor: Tutor, arguments: dict[str, Any]) -> None:
    call(tutor, "set_speaking_pace", arguments, {"summary": "ok"})


def test_pace_request_matches_the_browser() -> None:
    assert pace_request({"pace": "slow", "scope": "session"}) == ("slow", "session")
    assert pace_request({"pace": "slow", "scope": "once"}) == ("slow", "once")
    # "normal" always lasts; anything unrecognised is a one-off slow repeat.
    assert pace_request({"pace": "Normal", "scope": "once"}) == ("normal", "session")
    assert pace_request({}) == ("slow", "once")


def test_with_pace_appends_the_slow_note() -> None:
    assert with_pace("Prompt.", "slow", "Slowly.") == "Prompt. Slowly."
    assert with_pace("Prompt.", "normal", "Slowly.") == "Prompt."


def test_speak_more_slowly_lasts() -> None:
    tutor = Tutor(SERBIAN)
    pace(tutor, {"pace": "slow", "scope": "session"})
    assert tutor.instructions == f"{SERBIAN} {SLOW_NOTE}"
    asyncio.run(tutor.end_one_off_pace())
    assert tutor.instructions == f"{SERBIAN} {SLOW_NOTE}"
    pace(tutor, {"pace": "normal", "scope": "session"})
    assert tutor.instructions == SERBIAN


def test_a_slow_repeat_ends_on_the_next_turn() -> None:
    tutor = Tutor(SERBIAN)
    pace(tutor, {"pace": "slow", "scope": "once"})
    assert tutor.instructions == f"{SERBIAN} {SLOW_NOTE}"
    asyncio.run(tutor.end_one_off_pace())
    assert tutor.instructions == SERBIAN


def test_a_language_switch_keeps_a_slow_pace() -> None:
    tutor = Tutor(SERBIAN)
    pace(tutor, {"pace": "slow", "scope": "session"})
    detail = {"type": "practice_language", "language": "fr", "level": "beginner"}
    call(tutor, "set_practice_language", {}, {"summary": "ok", "detail": detail})
    assert tutor.instructions == f"{PROMPTS['fr']['beginner']} {SLOW_NOTE}"


def test_a_failed_tool_changes_nothing() -> None:
    tutor = Tutor(SERBIAN)
    call(tutor, "set_speaking_pace", {"pace": "slow"}, {"summary": "x", "error": "tool_unavailable"})
    call(tutor, "save_phrase", {}, {"summary": "Saved."})
    assert tutor.instructions == SERBIAN
