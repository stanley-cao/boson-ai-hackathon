"""Unit tests for the loop guard. No network, no keys."""

from loop_guard import strip_repeats

# The turns that started the loop in the live Serbian session.
LEARNER = "Dobro sam. Možeš li da mi pomogneš da pričam bolje?"


def test_an_echo_of_the_learner_is_stripped() -> None:
    reply = "Da, mogu. Možeš li da mi pomogneš da pričam bolje?"
    assert strip_repeats(reply, ["Dobro sam, hvala. A ti?"], LEARNER) == "Da, mogu."


def test_a_sentence_said_twice_before_is_stripped() -> None:
    # The live loop: the same question appended to every reply.
    line = "Možeš li da mi pomogneš da pričam bolje?"
    earlier = [f"Da, mogu. {line}", line]
    reply = f"Da, ponovila sam. {line}"
    assert strip_repeats(reply, earlier, "što ponavljaš?") == "Da, ponovila sam."


def test_a_restated_line_is_kept() -> None:
    # Teaching a phrase, then restating it as the correction, is tutoring.
    # Stripping it left "say that again slowly" repeating the learner's mistake.
    assert strip_repeats("Zovem se Sam.", ["Zovem se Sam."], "Ja zovem Sam.") is None
    line = "Watashi no namae wa Sam desu."
    assert strip_repeats(line, [line], "Watashi Sam desu.") is None


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
    assert strip_repeats(reply, [reply, "Neko.", reply], "Just one word at a time.") == ""
    # Said once before is ordinary conversation.
    assert strip_repeats("Great job!", ["Great job!", "Hai."], "Konnichiwa.") is None


def test_a_short_reply_on_its_third_time_is_stripped() -> None:
    # Live, a French session answered "Comment, ça, va?" to five different turns.
    earlier = ["Bonjour!", "Comment, ça, va?", "Comment, ça, va?"]
    assert strip_repeats("Comment, ça, va?", earlier, "No, no. I heard French.") == ""
    assert strip_repeats("Comment, ça, va?", earlier[:2], "No, no. I heard French.") is None

