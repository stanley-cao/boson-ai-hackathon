"""Unit tests for the loop guard. No network, no keys."""

import pytest

from loop_guard import strip_repeats

# The turns that started the loop in the live Serbian session.
LEARNER = "Dobro sam. Možeš li da mi pomogneš da pričam bolje?"


def test_an_echo_of_the_learner_is_stripped() -> None:
    reply = "Da, mogu. Možeš li da mi pomogneš da pričam bolje?"
    assert strip_repeats(reply, ["Dobro sam, hvala. A ti?"], LEARNER) == "Da, mogu."


def test_a_sentence_from_an_earlier_reply_is_stripped() -> None:
    earlier = ["Da, mogu. Možeš li da mi pomogneš da pričam bolje?"]
    reply = "Da, ponovila sam. Možeš li da mi pomogneš da pričam bolje?"
    assert strip_repeats(reply, earlier, "što ponavljaš?") == "Da, ponovila sam."


def test_case_and_punctuation_do_not_hide_a_repeat() -> None:
    assert strip_repeats("ja volim da čitam knjige!", [], "Ja volim da čitam knjige.") == ""


def test_a_fresh_reply_is_left_alone() -> None:
    reply = "Možeš da kažeš: Vikendom volim da čitam knjige."
    assert strip_repeats(reply, ["Zdravo! Kako si?"], "Šta voliš da radiš vikendom?") is None


def test_short_sentences_may_recur() -> None:
    # "A ti?" and "Hvala." come back every few turns in any real conversation.
    assert strip_repeats("Hvala. A ti?", ["Dobro sam. A ti?"], "Hvala.") is None


def test_empty_inputs_are_not_an_error() -> None:
    assert strip_repeats("", [], None) is None
    assert strip_repeats("Ja volim da čitam knjige.", [], None) is None


def test_a_repeat_the_learner_asked_for_is_kept() -> None:
    # From the live Japanese session: the guard used to cut this to "Of course!".
    reply = "Of course! Let's start with one word."
    assert strip_repeats(reply, [reply], "Please say that slower again.") is None
    assert strip_repeats(reply, [reply], "Možeš li to da ponoviš?") is None
    assert strip_repeats(reply, [reply], "もう一度お願いします") is None


def test_a_whole_reply_said_again_is_stripped_even_when_short_sentences() -> None:
    # From a probe: each sentence is under MIN_WORDS, but the reply looped.
    reply = "Hai, wakarimashita! (Yes, I understand!)"
    assert strip_repeats(reply, [reply], "Just one word at a time.") == ""
    # Two words said again later is ordinary conversation.
    assert strip_repeats("Great job!", ["Great job!", "Hai."], "Konnichiwa.") is None


def test_the_same_short_reply_twice_in_a_row_is_stripped() -> None:
    # Live, a French session answered "Comment, ça, va?" to five different turns.
    assert strip_repeats("Comment, ça, va?", ["Bonjour!", "Comment, ça, va?"], "No, no. I heard French.") == ""
    # Not when it isn't the reply just before.
    assert strip_repeats("Great job!", ["Great job!", "Hai."], "Hai.") is None


@pytest.mark.parametrize(
    "turn",
    [
        "Sorry, what?",
        "Pardon?",
        "Huh?",
        "I didn't catch that",
        "What did you say?",
        "Could you say it once more?",
        "Come again?",
        "Again, please",
        "Tu peux répéter ?",
        "Répète, s'il te plaît",
        "Comment ?",
        "Encore une fois",
        "다시 말해 주세요",
        "再说一遍",
        "Bạn có thể nói lại không?",
        "Nhắc lại đi",
        "Qu'est-ce que tu as dit ?",
        "Plus lentement s'il te plaît",
        "Molim?",
        "Nisam razumela",
        "Gì cơ?",
        "え？",
        "何て言いましたか",
        "뭐라고요?",
        "什么？",
        "你说什么？",
    ],
)
def test_ways_of_asking_for_a_repeat_keep_it(turn: str) -> None:
    reply = "Of course! Let's start with one word."
    assert strip_repeats(reply, [reply], turn) is None


@pytest.mark.parametrize("turn", ["I went there again yesterday and it was great.", "Encore du café ?"])
def test_again_in_passing_is_no_repeat_request(turn: str) -> None:
    reply = "Of course! Let's start with one word."
    assert strip_repeats(reply, [reply], turn) == ""
