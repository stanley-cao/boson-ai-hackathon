"""Spot a learner asking to practise another language.

The switch normally happens when the model calls set_practice_language, but
Higgs Realtime often doesn't: live, "can we switch to Japanese right now?" and
"switch properly to Japanese, please" got no call, so a French tutor kept
answering. The agent uses this to make the switch itself.
"""

import re

# Names a learner says for each target language (the codes in prompts.json).
LANGUAGE_NAMES = {
    "zh": ("mandarin", "chinese"),
    "ko": ("korean",),
    "fr": ("french",),
    "ja": ("japanese",),
    "sr": ("serbian",),
}

# A switch needs a verb aimed at the language, so "how do you say hello in
# Japanese?" doesn't count but "let's do Japanese" and "speak Japanese" do.
_VERB = (
    r"(?:switch(?:ed|ing)?|chang(?:e|ed|ing)|move|go|try|do|learn(?:ing)?|"
    r"practi[cs](?:e|ing)|speak(?:ing)?|teach(?:ing)?\s+me|study(?:ing)?)"
)
_NAMES = "|".join(name for names in LANGUAGE_NAMES.values() for name in names)
_SWITCH = re.compile(
    rf"\b{_VERB}\b(?:\s+\w+ly)?(?:\s+(?:over|on|back))?(?:\s+(?:to|into|in|with|some))?\s+(?:learning\s+|speaking\s+)?({_NAMES})\b",
    re.IGNORECASE,
)


def requested_language(learner_turn: str, current: str) -> str | None:
    """The language code the learner asked to switch to, or None.

    Only a language other than ``current`` counts: asking to practise the
    language already being taught is no switch.
    """
    for match in _SWITCH.finditer(learner_turn):
        name = match.group(1).lower()
        code = next(code for code, names in LANGUAGE_NAMES.items() if name in names)
        if code != current:
            return code
    return None
