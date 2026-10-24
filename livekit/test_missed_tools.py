"""Unit tests for saving phrases and corrections the model skipped. No network, no keys."""

import pytest

from missed_tools import correction_in, phrase_question, phrase_to_save


@pytest.mark.parametrize(
    ("turn", "reply", "current", "saved"),
    [
        # The three misses from the live probe.
        (
            "What does 加油 mean?",
            '加油 means "come on" or "keep going," like cheering someone on.',
            "zh",
            {"language": "zh", "phrase": "加油", "meaning": "come on or keep going"},
        ),
        # Live: a "!" inside the quotes ends the meaning too.
        (
            "What does 加油 mean?",
            '加油 means "come on!" or "keep it up!" It\'s used to cheer someone on.',
            "zh",
            {"language": "zh", "phrase": "加油", "meaning": "come on"},
        ),
        ("Teach me how to say good morning.", "早上好。", "zh", {"language": "zh", "phrase": "早上好", "meaning": "good morning"}),
        (
            "How do you say 'I would like a coffee' in French?",
            "Je voudrais un café.",
            "fr",
            {"language": "fr", "phrase": "Je voudrais un café.", "meaning": "I would like a coffee"},
        ),
        # Another language than the one practised, named in the question.
        (
            "How do you say thank you in Japanese?",
            "In Japanese, thank you is ありがとう.",
            "fr",
            {"language": "ja", "phrase": "ありがとう", "meaning": "thank you"},
        ),
        ("How do I say hello?", "You can say: Zdravo!", "sr", {"language": "sr", "phrase": "Zdravo!", "meaning": "hello"}),
        ("How do you say thanks?", "감사합니다. It means thank you.", "ko", {"language": "ko", "phrase": "감사합니다", "meaning": "thanks"}),
    ],
)
def test_a_taught_phrase_is_read_from_the_reply(turn: str, reply: str, current: str, saved: dict[str, str]) -> None:
    assert phrase_to_save(turn, reply, current) == saved


@pytest.mark.parametrize(
    ("turn", "reply"),
    [
        # Not a question about a phrase.
        ("I went to the shop yesterday.", "Great! What did you buy?"),
        # A meaning question whose reply never says what it means.
        ("What does 加油 mean?", "Good question! Let's practise it together."),
        # The reply only says the English back.
        ("How do you say good night?", "Good night."),
        ("How do you say thank you?", ""),
    ],
)
def test_it_gives_up_rather_than_guess(turn: str, reply: str) -> None:
    assert phrase_to_save(turn, reply, "fr") is None


def test_questions_are_recognised() -> None:
    assert phrase_question("what's 'merci' mean?") == ("meaning", "merci")
    assert phrase_question("What is the meaning of 早上好?") == ("meaning", "早上好")
    assert phrase_question("How would I say see you later in Korean?") == ("say", "see you later")
    assert phrase_question("Let's talk about food.") is None


def test_a_sentence_said_back_fixed_is_a_correction() -> None:
    # The live miss: the measure word 个 was missing.
    assert correction_in("我昨天去了商店买了三苹果。", "我昨天去了商店买了三个苹果。") == (
        "我昨天去了商店买了三苹果。",
        "我昨天去了商店买了三个苹果。",
    )
    assert correction_in(
        "Can you check my French? Je suis allé à la plage avec mon amis.",
        "Presque ! Je suis allé à la plage avec mon ami.",
    ) == ("Je suis allé à la plage avec mon amis.", "Je suis allé à la plage avec mon ami.")
    # An accent is a real mistake.
    assert correction_in("Je vais a la plage.", "Je vais à la plage.") == ("Je vais a la plage.", "Je vais à la plage.")


@pytest.mark.parametrize(
    ("turn", "reply"),
    [
        # Said back as it was: praise, not a fix.
        ("我昨天去了商店。", "我昨天去了商店！很好。"),
        # A reply, not the same sentence fixed.
        ("Je suis allé à la plage.", "Super ! Qu'est-ce que tu as fait à la plage ?"),
        # Too short to correct.
        ("Oui.", "Non."),
        ("", ""),
    ],
)
def test_other_replies_are_not_corrections(turn: str, reply: str) -> None:
    assert correction_in(turn, reply) is None
