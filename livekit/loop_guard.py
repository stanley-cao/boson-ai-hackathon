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
from collections import Counter

# A tutor line said this many times before is a loop; once before is a
# restatement, as when a correction repeats the phrase just taught.
LOOP_AFTER = 2

# Short sentences recur naturally ("A ti?", "Dobro!", "Hvala.") and are never
# what a loop is made of; only longer ones count as repeats.
MIN_WORDS = 4

# "Say that again", "slower", and the same in each language taught: a repeat
# the learner asked for is no loop, and stripping it would leave the model
# unsure what it just offered. Serbian ponovi, French encore/répète, Japanese
# もう一度, Korean 다시, Mandarin 再说/再一次.
_REPEAT_REQUEST = re.compile(
    r"\b(again|repeat|slower|slowly|one more time|ponovi\w*|encore|r[ée]p[èe]te\w*)\b|もう一度|다시|再说|再一次",
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

    Two kinds of repeat count. The learner's latest turn said back to them is
    stripped at once. A tutor line counts only from its third time: teaching
    "Zovem se Sam." and restating it as a correction is tutoring, and stripping
    the second left "say that again slowly" with only the learner's mistake to
    repeat. Returns "" when every sentence was a repeat, and None whenever the
    learner asked for a repeat.
    """
    if learner_turn and _REPEAT_REQUEST.search(learner_turn):
        return None
    # A whole reply counts even when each of its sentences is short: "How are
    # you?" and "Hai, wakarimashita! (Yes, I understand!)" looped live.
    whole = _key(reply)
    if whole and Counter(_key(text) for text in earlier_replies)[whole] >= LOOP_AFTER:
        return ""

    said = Counter(_key(s) for text in earlier_replies for s in _sentences(text))
    echoed = {_key(s) for s in _sentences(learner_turn or "")}
    kept: list[str] = []
    for sentence in _sentences(reply):
        key = _key(sentence)
        if len(key.split()) >= MIN_WORDS and (key in echoed or said[key] >= LOOP_AFTER):
            continue
        kept.append(sentence)
    if len(kept) == len(_sentences(reply)):
        return None
    return " ".join(kept)

