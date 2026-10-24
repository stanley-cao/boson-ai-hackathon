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


def test_every_exported_prompt_language_has_a_name() -> None:
    # A language added to src/lang/profiles.ts must be sayable here too.
    from session_config import load_prompts

    from language_switch import LANGUAGE_NAMES

    assert set(load_prompts()) == set(LANGUAGE_NAMES)


@pytest.mark.parametrize(
    ("turn", "code"),
    [
        ("How about Japanese?", "ja"),
        ("Japanese please", "ja"),
        ("I want Korean", "ko"),
        ("I'd rather learn Vietnamese", "vi"),
        ("Talk to me in Japanese", "ja"),
        ("Can we do this in Korean?", "ko"),
        ("Change the language to Korean", "ko"),
        ("Teach me some Mandarin", "zh"),
        # Asked in the language being taught, or another one.
        ("Parlons japonais", "ja"),
        ("On passe au coréen ?", "ko"),
        ("日本語で話しましょう", "ja"),
        ("일본어로 바꿔 주세요", "ja"),
        ("我们说日语吧", "ja"),
        ("Pričajmo japanski", "ja"),
        ("Chuyển sang tiếng Nhật nhé", "ja"),
    ],
)
def test_other_ways_of_asking_to_switch(turn: str, code: str) -> None:
    assert requested_language(turn, "fr") == code


@pytest.mark.parametrize(
    "turn",
    [
        # The agent forces a switch, so these must not count.
        "I don't want to switch to Japanese",
        "Let's not do Korean today",
        "I'm studying Japanese at school too",
        "I'm also learning Korean with my friend",
        "My friend speaks Korean",
        "Can you say that in Japanese?",
        "What's the difference between Chinese and Japanese?",
        "日语怎么说？",
    ],
)
def test_remarks_and_refusals_are_not_a_switch(turn: str) -> None:
    assert requested_language(turn, "fr") is None
