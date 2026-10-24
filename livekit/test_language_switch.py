"""Unit tests for spotting a spoken language switch. No network, no keys."""

import pytest

from language_switch import requested_language


@pytest.mark.parametrize(
    "turn",
    [
        # Said live in a French session, where the model called no tool.
        "Uh, so can we switch to Japanese right now?",
        "I know, no, I can be switched to learning Japanese.",
        "Switch properly to Japanese, please.",
        "Speak Japanese.",
        "Let's do Japanese instead.",
        "Can we practise Japanese?",
    ],
)
def test_a_switch_request_names_the_language(turn: str) -> None:
    assert requested_language(turn, "fr") == "ja"


@pytest.mark.parametrize(
    "turn",
    [
        # Asking about a word isn't asking to switch.
        "How do you say hello in Japanese?",
        "So, can you give me the translation of How are you in Japanese?",
        # Nor is naming the language already being taught.
        "I want to learn some French today.",
        "",
    ],
)
def test_other_turns_are_not_a_switch(turn: str) -> None:
    assert requested_language(turn, "fr") is None


def test_every_target_language_can_be_asked_for() -> None:
    assert requested_language("switch to Mandarin", "fr") == "zh"
    assert requested_language("let's learn Chinese", "fr") == "zh"
    assert requested_language("change to Korean", "fr") == "ko"
    assert requested_language("practice Serbian", "fr") == "sr"
    assert requested_language("let's do Vietnamese", "fr") == "vi"
    assert requested_language("go back to French", "ja") == "fr"
