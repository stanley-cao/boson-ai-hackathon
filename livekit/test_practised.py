"""Unit tests for practised-phrase tracking. No network, no keys."""

from practised import MAX_NAMED, PractisedPhrases, practised_phrase

REPLY = "Je voudrais un café. That means 'I would like a coffee.' Try saying it!"


def test_a_phrase_said_back_is_found_in_the_tutors_spelling() -> None:
    # Transcription often drops the accent.
    assert practised_phrase(REPLY, "Je voudrais un cafe.") == "Je voudrais un café."


def test_a_phrase_said_back_with_more_after_it_is_found() -> None:
    assert practised_phrase(REPLY, "Je voudrais un café. Is that right?") == "Je voudrais un café."


def test_a_quoted_phrase_is_found() -> None:
    reply = "Let's try «Où est la gare» — it means where is the station."
    assert practised_phrase(reply, "Où est la gare ?") == "Où est la gare"


def test_a_different_phrase_is_not_a_repeat() -> None:
    assert practised_phrase(REPLY, "Je voudrais un thé.") is None
    assert practised_phrase(REPLY, "What does voudrais mean?") is None


def test_single_words_are_not_tracked() -> None:
    assert practised_phrase("Bonjour! Say it with me.", "Bonjour!") is None


def test_phrases_without_spaces_are_found() -> None:
    assert practised_phrase("我想喝咖啡。 It means I want coffee.", "我想喝咖啡") == "我想喝咖啡。"


def test_empty_inputs_are_not_an_error() -> None:
    assert practised_phrase("", "") is None
    assert practised_phrase(REPLY, "") is None


def test_the_note_names_recent_phrases_per_language() -> None:
    phrases = PractisedPhrases()
    assert phrases.note("fr") == ""
    assert phrases.add("fr", "Je voudrais un café.")
    assert not phrases.add("fr", "je voudrais un cafe")
    assert '"Je voudrais un café."' in phrases.note("fr")
    assert phrases.note("ja") == ""


def test_the_note_keeps_only_the_most_recent() -> None:
    phrases = PractisedPhrases()
    for n in range(MAX_NAMED + 2):
        phrases.add("fr", f"phrase numéro {n}")
    note = phrases.note("fr")
    assert "numéro 0" not in note and "numéro 1\"" not in note
    assert f"numéro {MAX_NAMED + 1}" in note
