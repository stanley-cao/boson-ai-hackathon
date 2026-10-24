"""Unit tests for avatar-mode speaking pace. No network, no keys."""

import asyncio
from typing import Any

from agent import PACE_NOTES, PROMPTS, SLOW_NOTE, Tutor
from session_config import one_off_pace, pace_request, practice_focus, session_pace_for, with_pace

SERBIAN = PROMPTS["sr"]["beginner"]


def call(tutor: Tutor, name: str, arguments: dict[str, Any], result: dict[str, Any]) -> None:
    asyncio.run(tutor.after_tool(name, arguments, result, None))  # type: ignore[arg-type]


def pace(tutor: Tutor, arguments: dict[str, Any]) -> dict[str, Any]:
    result = {"summary": "ok"}
    call(tutor, "set_speaking_pace", arguments, result)
    return result


SLOWER_NOTE = PACE_NOTES["slower"]


def test_pace_request_matches_the_browser() -> None:
    assert pace_request({"pace": "slow", "scope": "session"}) == ("slow", "session")
    assert pace_request({"pace": "slow", "scope": "once"}) == ("slow", "once")
    # "normal" always lasts; anything unrecognised is a one-off slow repeat.
    assert pace_request({"pace": "Normal", "scope": "once"}) == ("normal", "session")
    assert pace_request({}) == ("slow", "once")
    assert pace_request({"pace": "even slower", "scope": "session"}) == ("slower", "session")


def test_with_pace_appends_the_pace_note() -> None:
    notes = {"slow": "Slowly.", "slower": "Very slowly."}
    assert with_pace("Prompt.", "slow", notes) == "Prompt. Slowly."
    assert with_pace("Prompt.", "slower", notes) == "Prompt. Very slowly."
    assert with_pace("Prompt.", "normal", notes) == "Prompt."


def test_pace_steps_match_the_browser() -> None:
    assert one_off_pace("slow", "normal") == "slow"
    assert one_off_pace("slow", "slow") == "slower"
    assert one_off_pace("slower", "normal") == "slower"
    assert session_pace_for("slow", "normal") == "slow"
    assert session_pace_for("slow", "slow") == "slower"
    assert session_pace_for("normal", "slower") == "normal"


def test_practice_focus_picks_the_study_item() -> None:
    assert practice_focus({"detail": {"type": "correction", "correct": "저는 학생이에요"}}) == "저는 학생이에요"
    assert practice_focus({"detail": {"type": "phrase", "phrase": " merci "}}) == "merci"
    assert practice_focus({"detail": {"type": "pronunciation", "target": "妈"}}) == "妈"
    assert practice_focus({"detail": {"type": "practice_language"}}) is None
    assert practice_focus({"summary": "ok"}) is None


def test_slow_down_twice_goes_slower() -> None:
    tutor = Tutor(SERBIAN)
    pace(tutor, {"pace": "slow", "scope": "session"})
    pace(tutor, {"pace": "slow", "scope": "session"})
    assert tutor.instructions == f"{SERBIAN} {SLOWER_NOTE}"


def test_a_second_slow_repeat_goes_slower() -> None:
    tutor = Tutor(SERBIAN)
    pace(tutor, {"pace": "slow", "scope": "once"})
    tutor.note_reply()  # the slow repeat
    asyncio.run(tutor.end_one_off_pace())
    pace(tutor, {"pace": "slow", "scope": "once"})
    assert tutor.instructions == f"{SERBIAN} {SLOWER_NOTE}"
    # Once the conversation has moved on, a repeat is slow again.
    tutor.note_reply()
    tutor.note_reply()
    asyncio.run(tutor.end_one_off_pace())
    pace(tutor, {"pace": "slow", "scope": "once"})
    assert tutor.instructions == f"{SERBIAN} {SLOW_NOTE}"


def test_a_slow_repeat_after_a_study_item_says_the_item() -> None:
    tutor = Tutor(SERBIAN)
    detail = {"type": "pronunciation", "language": "sr", "target": "ćao", "issue": "consonant", "tip": "Soft ć."}
    call(tutor, "pronunciation_feedback", {}, {"summary": "Saved.", "detail": detail})
    tutor.note_reply()  # the reply about ćao
    result = pace(tutor, {"pace": "slow", "scope": "once"})
    assert "say ćao again, slowly" in result["summary"]
    # A reply later, it is the last reply that gets repeated again.
    tutor.note_reply()
    tutor.note_reply()
    assert pace(tutor, {"pace": "slow", "scope": "once"})["summary"] == "ok"


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
