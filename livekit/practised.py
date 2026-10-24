"""Remember which phrases the learner has already practised.

Live, a French tutor offered a phrase, the learner said it back, they moved
on, and a few turns later the tutor offered the same phrase to practise again.
The model has no memory of "done" beyond the raw transcript, so the agent
spots each phrase the learner repeated and names the recent ones in the
instructions as already practised.

Detection is in code because the model skips tool calls too often to rely on
one for this.
"""

import difflib
import re
import unicodedata

# How close the learner's transcribed turn must be to the tutor's phrase.
# Transcription drops accents and mishears a sound or two, so exact matching
# missed real repeats. 0.9 allows a dropped letter ("je voudrai un cafe")
# but keeps "Je voudrais un café" apart from "Je voudrais un thé" (0.86).
MIN_SIMILARITY = 0.9

# Only the most recent phrases are named, so the instructions stay short:
# upstream found that a longer prompt stopped the model calling tools.
MAX_NAMED = 6

# Scripts written without spaces, where one "word" can be a whole phrase.
_NO_SPACES = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")
_SENTENCE_END = re.compile(r"(?<=[.!?…。！？])\s*")
# Phrases offered in quotes: «Je voudrais un café», "Où est la gare ?".
_QUOTED = re.compile(r"[«“\"「『]\s*([^«»“”\"「」『』]+?)\s*[»”\"」』]")
_NON_WORD = re.compile(r"[^\w\s]")


def _key(text: str) -> str:
    """Case, accents, punctuation and spacing don't make a phrase different."""
    # NFKD then NFC: strips accents but recomposes Hangul syllables.
    decomposed = unicodedata.normalize("NFKD", text.lower())
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(_NON_WORD.sub(" ", unicodedata.normalize("NFC", stripped)).split())


def _is_phrase(key: str) -> bool:
    # A single word ("Bonjour", "Merci") recurs in any conversation and isn't
    # worth steering the model away from.
    return len(key.split()) >= 2 or (bool(_NO_SPACES.search(key)) and len(key) >= 3)


def _segments(text: str) -> list[str]:
    sentences = [s.strip() for s in _SENTENCE_END.split(text) if s.strip()]
    return _QUOTED.findall(text) + sentences


def practised_phrase(tutor_reply: str, learner_turn: str) -> str | None:
    """The phrase from ``tutor_reply`` that ``learner_turn`` said back, or None.

    Returns the tutor's spelling, which is the correct one, rather than the
    learner's transcription.
    """
    spoken = [_key(s) for s in _segments(learner_turn)] + [_key(learner_turn)]
    for segment in _segments(tutor_reply):
        key = _key(segment)
        if not _is_phrase(key):
            continue
        for said in spoken:
            if said and difflib.SequenceMatcher(None, key, said).ratio() >= MIN_SIMILARITY:
                return segment
    return None


class PractisedPhrases:
    """Phrases practised so far, per language, oldest first."""

    def __init__(self) -> None:
        self._by_language: dict[str, list[str]] = {}

    def add(self, language: str, phrase: str) -> bool:
        """Record a phrase; False when it was already recorded."""
        phrases = self._by_language.setdefault(language, [])
        key = _key(phrase)
        if any(_key(p) == key for p in phrases):
            return False
        phrases.append(phrase)
        return True

    def note(self, language: str) -> str:
        """The instruction naming the recent practised phrases, or "" for none."""
        recent = self._by_language.get(language, [])[-MAX_NAMED:]
        if not recent:
            return ""
        quoted = ", ".join(f'"{p}"' for p in recent)
        return f"Already practised, so offer the learner new phrases instead: {quoted}."
