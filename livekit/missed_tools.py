"""Save a phrase or correction the model taught aloud without calling its tool.

Probed live in avatar mode (2026-10-24): after the first turn, "What does 加油
mean?", "Teach me how to say good morning" and "How do you say 'I would like
a coffee' in French?" were all answered with no save_phrase call, and
"我昨天去了商店买了三苹果" was corrected aloud with no note_correction. The
study panel then stays empty although the tutor taught something. Once the
reply is in, the agent reads what was taught from the learner's turn and the
reply, and makes the call itself.

Each extraction gives up rather than guess: a missed card costs less than a
wrong one on the learner's screen.
"""

import difflib
import re
import unicodedata

from language_switch import language_named

_QUOTES = "\"'“”‘’«»「」『』"

# "What does 加油 mean?", "what's 'merci' mean", "what is the meaning of 早上好?"
_MEANING = re.compile(
    r"\bwhat(?:\s+does|'s|\s+is)\s+(.+?)\s+mean\b|\bwhat\s+is\s+the\s+meaning\s+of\s+(.+?)\s*[?.!]*$|\bmeaning\s+of\s+(.+?)\s*[?.!]*$",
    re.IGNORECASE,
)
# "How do you say thank you in Chinese?", "teach me how to say good morning",
# "how would I say 'see you later'".
_HOW_TO_SAY = re.compile(
    r"\b(?:how\s+(?:do|would|can|should)\s+(?:you|i|we)\s+say|teach\s+me\s+(?:how\s+)?to\s+say|"
    r"what'?s\s+the\s+word\s+for)\s+(.+?)\s*(?:\bin\s+\w+(?:\s+\w+)?)?\s*[?.!]*$",
    re.IGNORECASE,
)

# "加油 means "come on" or "keep going," like cheering someone on."
_MEANS = re.compile(r"\bmeans?\s+(?:something\s+like\s+)?(.+?)(?:,[\"”']?\s*(?:like|as|and|which)\b|[.!?;][\"”']?\s|[.!?;]?$)", re.IGNORECASE)

# Each target language's own script, for finding the phrase in a reply.
_SCRIPT_RUN = {
    "zh": r"[\u3400-\u9fff]+(?:[\s，、]*[\u3400-\u9fff]+)*",
    "ja": r"[\u3040-\u30ff\u3400-\u9fff]+(?:[\s、]*[\u3040-\u30ff\u3400-\u9fff]+)*",
    "ko": r"[\uac00-\ud7a3]+(?:\s+[\uac00-\ud7a3]+)*",
}
# "In French, you say …", "You can say: …", "It's …".
_LEAD_IN = re.compile(
    r"^(?:in\s+\w+,?\s*)?(?:you\s+(?:can\s+|would\s+|could\s+)?say|you'?d\s+say|we\s+say|it'?s|that'?s|say)\s*:?\s*",
    re.IGNORECASE,
)
_SENTENCE = re.compile(r"[^.!?。！？]+[.!?。！？]?")
_QUOTED = re.compile(r"[\"“«「『']\s*([^\"“”«»「」『』']+?)\s*[\"”»」』']")
_NON_WORD = re.compile(r"[^\w\s]")


def _clean(text: str) -> str:
    return " ".join(text.strip(_QUOTES + " ").replace("\"", "").replace("“", "").replace("”", "").split()).rstrip(",")


def _key(text: str) -> str:
    """Case and punctuation don't make a phrase different."""
    return " ".join(_NON_WORD.sub(" ", text.lower()).split())


def _bare(key: str) -> str:
    """A key without accents. Transcription drops them, so "cafe" for "café"
    is how the learner's speech came back, not something they got wrong."""
    decomposed = unicodedata.normalize("NFKD", key)
    return unicodedata.normalize("NFC", "".join(c for c in decomposed if not unicodedata.combining(c)))


# "What does that mean?" and "How do you say it in French?" point back at
# something said earlier; saving "that" as the phrase would be a wrong card.
_VAGUE = {
    "that", "this", "it", "that one", "this one", "that word", "this word",
    "that phrase", "this phrase", "that sentence", "this sentence", "what you said",
}


def phrase_question(turn: str) -> tuple[str, str] | None:
    """("meaning", phrase) or ("say", meaning) when the learner asks about a phrase."""
    if match := _MEANING.search(turn):
        phrase = _clean(next(g for g in match.groups() if g))
        return ("meaning", phrase) if phrase else None
    if match := _HOW_TO_SAY.search(turn):
        meaning = _clean(match.group(1))
        return ("say", meaning) if meaning else None
    return None


def _phrase_in(reply: str, language: str, meaning: str) -> str | None:
    """The target-language phrase a reply teaches, or None when it can't tell."""
    if language in _SCRIPT_RUN:
        match = re.search(_SCRIPT_RUN[language], reply)
        return match.group(0).strip() if match else None
    # Latin script: a quoted phrase, else the first sentence without its
    # English lead-in. Never the English meaning said back.
    candidates = _QUOTED.findall(reply) + [
        _LEAD_IN.sub("", s.strip()) for s in _SENTENCE.findall(reply)[:1]
    ]
    for candidate in candidates:
        phrase = _clean(candidate)
        if phrase and _key(meaning) not in _key(phrase) and not re.search(r"\bmeans?\b", phrase, re.I):
            return phrase
    return None


def saved_key(text: str) -> str:
    """What a saved phrase or correction is remembered by, to save it only once."""
    return _bare(_key(text))


def phrase_to_save(learner_turn: str, reply: str, current: str) -> dict[str, str] | None:
    """save_phrase arguments for what the reply taught, or None."""
    question = phrase_question(learner_turn)
    if question is None or not reply.strip():
        return None
    kind, text = question
    if _key(text) in _VAGUE:
        return None
    # "How do you say thank you in Japanese?" while practising French.
    language = language_named(learner_turn) or current
    if kind == "meaning":
        match = _MEANS.search(reply)
        meaning = _clean(match.group(1)) if match else ""
        if not meaning or _key(meaning) == _key(text):
            return None
        return {"language": language, "phrase": text, "meaning": meaning}
    phrase = _phrase_in(reply, language, text)
    if phrase is None or _key(phrase) == _key(text):
        return None
    return {"language": language, "phrase": phrase, "meaning": text}


# A sentence said back this close, but not identical, is the tutor's
# correction of it. Below 0.75 it's a different sentence (a reply, not a fix).
MIN_SIMILARITY = 0.75

# Common English words. A learner sentence made of them is English, which
# the tutor rephrases rather than corrects. Leaves out words the languages
# taught share with English, such as French "a", "on" and "en".
_ENGLISH = {
    "i", "you", "the", "to", "is", "are", "was", "were", "it", "and", "my", "your",
    "we", "they", "what", "do", "did", "have", "has", "this", "that", "of", "in",
    "went", "go", "can", "with", "for", "at", "me", "be", "how",
}


def _first_word(key: str) -> str:
    # Chinese and Japanese have no spaces: their first two characters.
    first = key.split()[0] if key else ""
    return first[:2] if re.search(r"[\u3040-\u30ff\u3400-\u9fff]", first) else first


def correction_in(learner_turn: str, reply: str, language: str) -> tuple[str, str] | None:
    """(said, correct) when the reply says one of the learner's sentences back fixed.

    Not when the reply only echoes it in other words: "Tu es allé à la plage !"
    for "Je suis allé à la plage." changes the subject, which a fix keeps.
    """
    said_sentences = [s.strip() for s in _SENTENCE.findall(learner_turn) if s.strip()]
    reply_sentences = [s.strip() for s in _SENTENCE.findall(reply) if s.strip()]
    for said in said_sentences:
        said_key = _key(said)
        # Short turns ("Oui.", "好的") have nothing to correct, and differ by
        # chance.
        if len(said_key.replace(" ", "")) < 6:
            continue
        words = said_key.split()
        if language != "en" and sum(w in _ENGLISH for w in words) >= 0.3 * len(words):
            continue
        for correct in reply_sentences:
            correct_key = _key(correct)
            if _bare(correct_key) == _bare(said_key) or _first_word(_bare(correct_key)) != _first_word(_bare(said_key)):
                continue
            if difflib.SequenceMatcher(None, said_key, correct_key).ratio() >= MIN_SIMILARITY:
                return said, correct
    return None
