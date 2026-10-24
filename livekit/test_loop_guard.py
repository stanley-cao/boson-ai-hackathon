"""Unit tests for the loop guard. No network, no keys."""

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
