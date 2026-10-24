"""Keep the tutor from looping on one line.

Higgs Realtime sometimes echoes the learner's sentence back, then appends that
same sentence to every later reply (seen live in Serbian, in both the agent and
the browser's direct mode, at temperature 0.3 and 0.8). The repeat is already
spoken by the time its text is known, so it can't be stopped. What feeds the
loop is the repeat staying in the model's context, where the model copies it.
The agent strips repeated sentences from the stored reply, so there's nothing
left to copy.
"""

import re

# Short sentences recur naturally ("A ti?", "Dobro!", "Hvala.") and are never
# what a loop is made of; only longer ones count as repeats.
MIN_WORDS = 4

# "Say that again", "slower", and the same in each language taught: a repeat
# the learner asked for is no loop, and stripping it would leave the model
# unsure what it just offered. A false alarm only leaves the guard off for one
# turn, so this leans towards matching; but "again" and "encore" alone are
# everyday words ("Encore du café ?"), so they count only as the whole turn.
_REPEAT_REQUEST = re.compile(
    "|".join(
        [
            # English
            r"\brepeat\w*",
            r"\b(?:say|said)\s+(?:that|it|this)?\s*(?:again|once\s+more|one\s+more\s+time)\b",
            r"\bcome\s+again\b",
            r"\b(?:one\s+more\s+time|once\s+more)\b",
            r"\bslow(?:er|ly|\s+down)\b",
            r"\b(?:didn'?t|did\s+not|couldn'?t|can'?t|cannot)\s+(?:catch|hear|understand|get)\b",
            r"\bwhat\s+did\s+you\s+(?:just\s+)?say\b",
            r"\bsorry,?\s+what\b",
            r"\bpardon\b",
            r"^\W*(?:sorry|huh|what|excuse\s+me|again|encore)(?:\W+(?:please|une\s+fois|s'il\s+(?:te|vous)\s+pla[iî]t))?\W*$",
            # French: répéter, répète, répétez; "Comment ?" alone.
            r"\br[ée]p[éeè]t\w*",
            r"\bencore\s+une\s+fois\b",
            r"\bplus\s+lentement\b",
            r"\bje\s+n'ai\s+pas\s+(?:compris|entendu)\b",
            r"^\W*comment\W*$",
            # Serbian
            r"\bponovi\w*",
            r"\bsporije\b",
            r"\bnisam\s+(?:razume|ču)\w*",
            # Vietnamese: nói lại, nhắc lại, chậm lại, một lần nữa.
            r"\b(?:nói|nhắc)\s+lại\b",
            r"\bchậm\s+(?:lại|hơn)\b",
            r"\bmột\s+lần\s+nữa\b",
            # Japanese, Korean, Mandarin
            r"もう一度|もう一回|ゆっくり|繰り返",
            r"다시|천천히|뭐라고",
            r"再说|再一次|慢一点|重复",
        ]
    ),
    re.IGNORECASE,
)
_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
_NON_WORD = re.compile(r"[^\w\s]")


def _sentences(text: str) -> list[str]:
    return [s for s in _SENTENCE_END.split(text.strip()) if s]


def _key(sentence: str) -> str:
    """Case, punctuation and spacing don't make a sentence new."""
    return " ".join(_NON_WORD.sub(" ", sentence.lower()).split())


def strip_repeats(reply: str, earlier_replies: list[str], learner_turn: str | None) -> str | None:
    """The reply without sentences it repeats, or None when nothing repeats.

    A sentence repeats when it already appeared in an earlier tutor reply, or
    is the learner's latest turn said back to them. Returns "" when every
    sentence was a repeat, and None whenever the learner asked for a repeat.
    """
    if learner_turn and _REPEAT_REQUEST.search(learner_turn):
        return None
    # A whole reply said again counts even when each of its sentences is short:
    # "Hai, wakarimashita! (Yes, I understand!)" looped turn after turn.
    whole = _key(reply)
    if len(whole.split()) >= MIN_WORDS and whole in {_key(text) for text in earlier_replies}:
        return ""
    # The same reply twice in a row is a loop at any length: "How are you?"
    # and "Comment, ça, va?" each came back turn after turn, live.
    if whole and earlier_replies and whole == _key(earlier_replies[-1]):
        return ""

    seen = {_key(s) for text in earlier_replies for s in _sentences(text)}
    if learner_turn:
        seen.update(_key(s) for s in _sentences(learner_turn))

    kept: list[str] = []
    for sentence in _sentences(reply):
        key = _key(sentence)
        if len(key.split()) >= MIN_WORDS and key in seen:
            continue
        kept.append(sentence)
    if len(kept) == len(_sentences(reply)):
        return None
    return " ".join(kept)
