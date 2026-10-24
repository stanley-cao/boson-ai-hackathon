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
    """Case and punctuation, but not accents: "a" for "à" is a real mistake."""
    return " ".join(_NON_WORD.sub(" ", text.lower()).split())


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


def phrase_to_save(learner_turn: str, reply: str, current: str) -> dict[str, str] | None:
    """save_phrase arguments for what the reply taught, or None."""
    question = phrase_question(learner_turn)
    if question is None or not reply.strip():
        return None
    kind, text = question
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


def correction_in(learner_turn: str, reply: str) -> tuple[str, str] | None:
    """(said, correct) when the reply says one of the learner's sentences back fixed."""
    said_sentences = [s.strip() for s in _SENTENCE.findall(learner_turn) if s.strip()]
    reply_sentences = [s.strip() for s in _SENTENCE.findall(reply) if s.strip()]
    for said in said_sentences:
        said_key = _key(said)
        # Short turns ("Oui.", "好的") have nothing to correct, and differ by
        # chance.
        if len(said_key.replace(" ", "")) < 6:
            continue
        for correct in reply_sentences:
            correct_key = _key(correct)
            if correct_key == said_key:
                continue
            if difflib.SequenceMatcher(None, said_key, correct_key).ratio() >= MIN_SIMILARITY:
                return said, correct
    return None
