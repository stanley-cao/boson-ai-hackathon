"""Spot a learner asking to practise another language.

The switch normally happens when the model calls set_practice_language, but
Higgs Realtime often doesn't: live, "can we switch to Japanese right now?" and
"switch properly to Japanese, please" got no call, so a French tutor kept
answering. The agent uses this to make the switch itself.

The agent forces the switch, so a false alarm costs more than a miss (the
model may still call the tool): a negated request or a remark about the
learner's studies must not count.
"""

import re

# Names a learner says for each target language (the codes in prompts.json).
LANGUAGE_NAMES = {
    "zh": ("mandarin", "chinese"),
    "ko": ("korean",),
    "fr": ("french",),
    "ja": ("japanese",),
    "sr": ("serbian",),
    "vi": ("vietnamese",),
}

# The same names in the languages taught, for a request made in one of them
# ("Parlons japonais", "日本語で話しましょう"). Lowercase and as transcribed;
# Serbian in Latin script, as the tutor writes it.
NATIVE_NAMES = {
    "zh": ("chinois", "中文", "汉语", "普通话", "중국어", "中国語", "kineski", "tiếng trung"),
    "ko": ("coréen", "coreen", "韩语", "한국어", "韓国語", "korejski", "tiếng hàn"),
    "fr": ("français", "francais", "法语", "프랑스어", "フランス語", "francuski", "tiếng pháp"),
    "ja": ("japonais", "日语", "日本語", "일본어", "japanski", "tiếng nhật"),
    "sr": ("serbe", "塞尔维亚语", "세르비아어", "セルビア語", "srpski", "tiếng serbia"),
    "vi": ("vietnamien", "越南语", "베트남어", "ベトナム語", "vijetnamski", "tiếng việt"),
}

_CODE_FOR = {
    name: code
    for table in (LANGUAGE_NAMES, NATIVE_NAMES)
    for code, names in table.items()
    for name in names
}
# Longest first, so "tiếng việt" wins over a shorter name inside it.
_NAMES = "|".join(sorted(map(re.escape, _CODE_FOR), key=len, reverse=True))
_NAME = rf"({_NAMES})"

# A switch needs a verb aimed at the language, so "how do you say hello in
# Japanese?" doesn't count but "let's do Japanese" and "speak Japanese" do.
_VERB = (
    r"(?:switch(?:ed|ing)?|chang(?:e|ed|ing)|move|go|try|do|learn(?:ing)?|"
    r"practi[cs](?:e|ing)|speak(?:ing)?|teach(?:ing)?\s+me|study(?:ing)?)"
)
_ENGLISH = [
    # "switch to Japanese", "change the language to Korean", "go back to French".
    rf"\b{_VERB}\b(?:\s+\w+ly)?(?:\s+(?:the\s+)?(?:language|lesson|it|this|us))?"
    rf"(?:\s+(?:over|on|back))?(?:\s+(?:to|into|in|with|some))?\s+(?:learning\s+|speaking\s+)?{_NAME}",
    rf"\b(?:how|what)\s+about\s+(?:some\s+)?{_NAME}",
    rf"\b(?:i\s+want|i'?d\s+like|i\s+would\s+like|i'?d\s+rather)\s+(?:to\s+do\s+|some\s+)?{_NAME}",
    # "talk to me in Japanese", "can we do this in Korean?". Not "say … in":
    # "can you say that in Japanese?" asks for a translation.
    rf"\b(?:talk|speak|reply|answer|respond|chat|continue|do\s+(?:this|it|that))"
    rf"(?:\s+(?:to|with)\s+me)?\s+in\s+{_NAME}",
    # The whole turn is the language: "Japanese please", "Korean!".
    rf"^\W*{_NAME}(?:\s+(?:please|now|instead))*\W*$",
]
_NATIVE = [
    # French: "parlons japonais", "on passe au coréen", "passons à l'espagnol".
    rf"\b(?:parl(?:ons|e|ez)|passons|on\s+passe|changeons)\s+(?:(?:au|à\s+l'|à\s+la|en|pour\s+le|le|l')\s*)?{_NAME}",
    # Serbian: "pričajmo japanski", "pređimo na japanski".
    rf"\b(?:pričajmo|govorimo|pređimo\s+na|prebaci\w*\s+na|hajde\s+(?:na\s+)?)\s*{_NAME}",
    # Vietnamese: "nói tiếng Nhật", "chuyển sang tiếng Hàn".
    rf"\b(?:nói|học|chuyển\s+sang|đổi\s+sang)\s+{_NAME}",
    # Japanese: "日本語で話しましょう", "韓国語に変えて". No word boundaries in CJK.
    rf"{_NAME}\s*(?:で(?:話|はな)(?:しましょう|して|そう)|に(?:変え|切り替え))",
    # Korean: "일본어로 바꿔 주세요", "일본어로 하자".
    rf"{_NAME}\s*(?:으로|로)\s*(?:바꿔|하자|해요|해\s*주세요|말해|얘기)",
    # Mandarin: "说日语", "换成韩语". Not "日语怎么说", which comes after the name.
    rf"(?:换成|改成|切换到|换到|说|讲|学)\s*{_NAME}",
]
_SWITCH = [re.compile(p, re.IGNORECASE) for p in _ENGLISH + _NATIVE]

# "I don't want to switch to Japanese", "let's not do Korean".
_NEGATED = re.compile(
    r"\b(?:don'?t|do\s+not|doesn'?t|not|never|won'?t|wouldn'?t|can'?t|cannot|no\s+more)\s+(?:\w+\s+){0,3}$",
    re.IGNORECASE,
)
# "I'm studying Japanese at school" reports a fact; it isn't a request. The
# subject comes before the match, the -ing verb starts it.
_STATEMENT_SUBJECT = re.compile(
    r"\b(?:i'?m|i\s+am|i\s+was|i'?ve\s+been|we'?re|we\s+are|they'?re|he'?s|she'?s)\s+(?:\w+ly\s+|also\s+)?$",
    re.IGNORECASE,
)
_STATEMENT_VERB = re.compile(r"(?:learning|studying|practi[cs]ing|speaking)\b", re.IGNORECASE)


def requested_language(learner_turn: str, current: str) -> str | None:
    """The language code the learner asked to switch to, or None.

    Only a language other than ``current`` counts: asking to practise the
    language already being taught is no switch.
    """
    for pattern in _SWITCH:
        for match in pattern.finditer(learner_turn):
            before = learner_turn[: match.start()]
            if _NEGATED.search(before):
                continue
            if _STATEMENT_SUBJECT.search(before) and _STATEMENT_VERB.match(match.group(0)):
                continue
            code = _CODE_FOR[match.group(1).lower()]
            if code != current:
                return code
    return None
