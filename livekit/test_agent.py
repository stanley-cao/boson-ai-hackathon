"""Focused tests for quiz-specific LiveKit tutor turn configuration."""

import asyncio
from types import SimpleNamespace
from typing import Any

from agent import Tutor


def test_quiz_opening_disables_tools_then_restores_forced_grading() -> None:
    replies: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    tutor = Tutor("quiz instructions", "quiz")
    tutor._activity = SimpleNamespace(  # type: ignore[attr-defined]
        session=SimpleNamespace(generate_reply=lambda **kwargs: replies.append(kwargs)),
        update_options=lambda **kwargs: updates.append(kwargs),
    )

    asyncio.run(tutor.on_enter())

    assert replies[0]["tool_choice"] == "none"
    assert "question 1 of 5" in replies[0]["instructions"]
    assert updates == [{
        "tool_choice": {"type": "function", "function": {"name": "grade_quiz_answer"}}
    }]


def test_conversation_opening_keeps_automatic_tool_choice() -> None:
    replies: list[dict[str, Any]] = []
    updates: list[dict[str, Any]] = []
    tutor = Tutor("conversation instructions", "conversation")
    tutor._activity = SimpleNamespace(  # type: ignore[attr-defined]
        session=SimpleNamespace(generate_reply=lambda **kwargs: replies.append(kwargs)),
        update_options=lambda **kwargs: updates.append(kwargs),
    )

    asyncio.run(tutor.on_enter())

    assert replies[0]["tool_choice"] == "auto"
    assert updates == []
