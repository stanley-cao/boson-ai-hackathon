"""Spot a learner asking to practise another language.

The switch normally happens when the model calls set_practice_language, but
Higgs Realtime often doesn't: live, "can we switch to Japanese right now?" and
"switch properly to Japanese, please" got no call, so a French tutor kept
answering. The agent uses this to make the switch itself.

The agent forces the switch, so a false alarm costs more than a miss (the
model may still call the tool): a negated request or a remark about the
learner's studies must not count.
"""

import json
import re

from session_config import SHARED

# Names a learner says for each target language (the codes in prompts.json),
# exported from src/tools/handlers.ts by `npm run export-config`. Raises if
# missing, like load_prompts.
LANGUAGE_NAMES: dict[str, list[str]] = json.loads((SHARED / "languages.json").read_text(encoding="utf-8"))

# The same names in the languages first taught (French, Mandarin, Korean,
# Japanese, Serbian, Vietnamese), for a request made in one of them ("Parlons
# japonais", "日本語で話しましょう"). Lowercase and as transcribed; Serbian in
# Latin script, as the tutor writes it. Only the most studied of the other
# languages are here; the rest are matched by their English names.
NATIVE_NAMES = {
    "zh": ("chinois", "中文", "汉语", "普通话", "중국어", "中国語", "kineski", "kineskom", "tiếng trung"),
    "ko": ("coréen", "coreen", "韩语", "한국어", "韓国語", "korejski", "korejskom", "tiếng hàn"),
    "fr": ("français", "francais", "法语", "프랑스어", "フランス語", "francuski", "francuskom", "tiếng pháp"),
    "ja": ("japonais", "日语", "日本語", "일본어", "japanski", "japanskom", "tiếng nhật"),
    "sr": ("serbe", "塞尔维亚语", "세르비아어", "セルビア語", "srpski", "srpskom", "tiếng serbia"),
    "vi": ("vietnamien", "越南语", "베트남어", "ベトナム語", "vijetnamski", "vijetnamskom", "tiếng việt"),
    "de": ("allemand", "德语", "독일어", "ドイツ語", "nemački", "nemačkom", "tiếng đức"),
    "es": ("espagnol", "西班牙语", "스페인어", "スペイン語", "španski", "španskom", "tiếng tây ban nha"),
    "it": ("italien", "意大利语", "이탈리아어", "イタリア語", "italijanski", "italijanskom", "tiếng ý"),
    "pt": ("portugais", "葡萄牙语", "포르투갈어", "ポルトガル語", "portugalski", "portugalskom", "tiếng bồ đào nha"),
    "ru": ("russe", "俄语", "러시아어", "ロシア語", "ruski", "ruskom", "tiếng nga"),
    "ar": ("arabe", "阿拉伯语", "아랍어", "アラビア語", "arapski", "arapskom", "tiếng ả rập"),
    "hi": ("hindi", "印地语", "힌디어", "ヒンディー語", "hindi", "tiếng hindi"),
    "nl": ("néerlandais", "neerlandais", "荷兰语", "네덜란드어", "オランダ語", "holandski", "holandskom", "tiếng hà lan"),
    "tr": ("turc", "土耳其语", "터키어", "トルコ語", "turski", "turskom", "tiếng thổ nhĩ kỳ"),
    "pl": ("polonais", "波兰语", "폴란드어", "ポーランド語", "poljski", "poljskom", "tiếng ba lan"),
    "th": ("thaï", "泰语", "태국어", "タイ語", "tajlandski", "tajlandskom", "tiếng thái"),
    "id": ("indonésien", "indonesien", "印尼语", "인도네시아어", "インドネシア語", "indonežanski", "indonežanskom", "tiếng indonesia"),
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
_ARTICLE = r"(?:(?:au|à\s+l'|à\s+la|en|pour\s+le|le|la|l'|du|de\s+l')\s*)?"
_NATIVE = [
    # French: "parlons japonais", "on passe au coréen", "faisons du japonais".
    rf"\b(?:parl(?:ons|e|ez)|passons|on\s+passe|changeons|faisons|on\s+fait)\s+{_ARTICLE}{_NAME}",
    # "je veux passer au japonais", "tu peux parler japonais ?". Only after a
    # wish or "can": "j'apprends le japonais à l'école" is a remark.
    rf"\b(?:veux|voudrais|aimerais|peux|peut|pouvons|pourrais|pourrait|pourriez|pouvez|on\s+va)(?:-tu|-vous|-on)?"
    rf"\s+(?:\w+\s+)?(?:passer|parler|apprendre|pratiquer|essayer|faire|changer\s+pour)\s+{_ARTICLE}{_NAME}",
    rf"^\W*en\s+{_NAME}(?:\W+(?:s'il\s+(?:te|vous)\s+pla[iî]t|stp|svp|maintenant))?\W*$",
    # Serbian: "pričajmo japanski", "pređimo na japanski", "pričaj na japanskom".
    rf"\b(?:pričaj(?:mo|te)?|pričamo|pričati|govori(?:mo|te)?|govoriti|pređ(?:imo|em|emo)\s+na|"
    rf"prebaci\w*\s+na|hajde\s+(?:na\s+)?|uč(?:imo|iti))\s+(?:na\s+)?{_NAME}",
    # Vietnamese: "nói tiếng Nhật", "dạy tôi tiếng Nhật", "nói bằng tiếng Hàn".
    rf"\b(?:nói|học|dạy\s+(?:tôi|mình|em|tớ)|chuyển\s+sang|đổi\s+sang)\s+(?:bằng\s+)?{_NAME}",
    # Japanese: "日本語で話しましょう", "日本語にしよう", "韓国語でお願いします",
    # "日本語を練習したい". No word boundaries in CJK.
    rf"{_NAME}\s*(?:で(?:話|はな)(?:しましょう|して|そう)|でお願い|に(?:変え|切り替え|しよう|しましょう|して)|"
    rf"を(?:練習|勉強)(?:しましょう|したい|しよう))",
    # Korean: "일본어로 바꿔 주세요", "일본어로 말해 줘", "일본어 연습하고 싶어요".
    rf"{_NAME}\s*(?:(?:으로|로)\s*(?:바꿔|바꾸자|하자|해요|해\s*주세요|해\s*줘|말해|얘기)|"
    rf"(?:를|을)?\s*(?:연습하|배우)(?:자|고\s*싶))",
    # Mandarin: "说日语", "换成韩语", "用日语聊吧". Not "日语怎么说" or
    # "用日语怎么说", which ask for a translation.
    rf"(?:换成|改成|切换到|换到|说|讲|学)\s*{_NAME}",
    rf"用\s*{_NAME}\s*(?:聊|说吧|讲吧|交流|对话)",
]
_SWITCH = [re.compile(p, re.IGNORECASE) for p in _ENGLISH + _NATIVE]

# A negation just before the request, in any language taught: "I don't want
# to switch to Japanese", "je ne veux pas passer au japonais", "ne želim da
# pređem na japanski", "tôi không muốn học tiếng Nhật", "我不想说日语". A comma
# ends the reach, so "pas de souci, on passe au japonais" still switches.
# Japanese and Korean negate after the verb, which the patterns don't accept.
_NEGATED = re.compile(
    "|".join(
        [
            r"\b(?:don'?t|do\s+not|doesn'?t|(?<!why\s)not|never|won'?t|wouldn'?t|can'?t|cannot|no\s+more)\s+(?:\w+\s+){0,3}$",
            r"(?:\bne\b|\bn'|\bpas\b|\bjamais\b)\s*(?:[\w'-]+\s+){0,3}$",
            r"\b(?:nemoj\w*|neću|nećemo)\s+(?:\w+\s+){0,3}$",
            r"\b(?:không|đừng|chẳng|chưa)\s+(?:\w+\s+){0,3}$",
            r"[不别没甭](?:想|要|用|会|再)?\s*$",
        ]
    ),
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


_IN_LANGUAGE = re.compile(rf"\bin\s+{_NAME}", re.IGNORECASE)


def language_named(turn: str) -> str | None:
    """The language a question is about: "how do you say thank you in Japanese?" → "ja"."""
    match = _IN_LANGUAGE.search(turn)
    return _CODE_FOR[match.group(1).lower()] if match else None
