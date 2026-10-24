"""Unit tests for spotting a spoken language switch. No network, no keys."""

import pytest

from language_switch import requested_language


@pytest.mark.parametrize(
    "turn",
    [
        # Said live in a French session, where the model called no tool.
        "Uh, so can we switch to Japanese right now?",
        "I know, no, I can be switched to learning Japanese.",
        "Switch properly to Japanese, please.",
        "Speak Japanese.",
        "Let's do Japanese instead.",
        "Can we practise Japanese?",
    ],
)
def test_a_switch_request_names_the_language(turn: str) -> None:
    assert requested_language(turn, "fr") == "ja"


@pytest.mark.parametrize(
    "turn",
    [
        # Asking about a word isn't asking to switch.
        "How do you say hello in Japanese?",
        "So, can you give me the translation of How are you in Japanese?",
        # Nor is naming the language already being taught.
        "I want to learn some French today.",
        "",
    ],
)
def test_other_turns_are_not_a_switch(turn: str) -> None:
    assert requested_language(turn, "fr") is None


def test_every_target_language_can_be_asked_for() -> None:
    assert requested_language("switch to Mandarin", "fr") == "zh"
    assert requested_language("let's learn Chinese", "fr") == "zh"
    assert requested_language("change to Korean", "fr") == "ko"
    assert requested_language("practice Serbian", "fr") == "sr"
    assert requested_language("let's do Vietnamese", "fr") == "vi"
    assert requested_language("go back to French", "ja") == "fr"
    assert requested_language("let's do German", "fr") == "de"
    assert requested_language("practice Haitian Creole", "fr") == "ht"
    assert requested_language("switch to Māori", "fr") == "mi"
    assert requested_language("can we speak Farsi?", "fr") == "fa"


def test_codes_are_not_names() -> None:
    # "it" and "no" are Italian's and Norwegian's codes, and ordinary words.
    assert requested_language("let's do it", "fr") is None
    assert requested_language("I want no more", "fr") is None


def test_every_exported_prompt_language_has_a_name() -> None:
    # A language added to src/lang/profiles.ts must be sayable here too.
    from session_config import load_prompts

    from language_switch import LANGUAGE_NAMES

    assert set(load_prompts()) == set(LANGUAGE_NAMES)


@pytest.mark.parametrize(
    ("turn", "code"),
    [
        ("How about Japanese?", "ja"),
        ("Japanese please", "ja"),
        ("I want Korean", "ko"),
        ("I'd rather learn Vietnamese", "vi"),
        ("Talk to me in Japanese", "ja"),
        ("Can we do this in Korean?", "ko"),
        ("Change the language to Korean", "ko"),
        ("Teach me some Mandarin", "zh"),
        # Asked in the language being taught, or another one.
        ("Parlons japonais", "ja"),
        ("On passe au coréen ?", "ko"),
        ("日本語で話しましょう", "ja"),
        ("일본어로 바꿔 주세요", "ja"),
        ("我们说日语吧", "ja"),
        ("Pričajmo japanski", "ja"),
        ("Chuyển sang tiếng Nhật nhé", "ja"),
    ],
)
def test_other_ways_of_asking_to_switch(turn: str, code: str) -> None:
    assert requested_language(turn, "fr") == code


@pytest.mark.parametrize(
    "turn",
    [
        # The agent forces a switch, so these must not count.
        "I don't want to switch to Japanese",
        "Let's not do Korean today",
        "I'm studying Japanese at school too",
        "I'm also learning Korean with my friend",
        "My friend speaks Korean",
        "Can you say that in Japanese?",
        "What's the difference between Chinese and Japanese?",
        "日语怎么说？",
    ],
)
def test_remarks_and_refusals_are_not_a_switch(turn: str) -> None:
    assert requested_language(turn, "fr") is None


@pytest.mark.parametrize(
    ("turn", "code"),
    [
        ("Why not switch to Japanese?", "ja"),
        ("Switch to Japanese, not Korean", "ja"),
        ("Je veux passer au japonais", "ja"),
        ("Tu peux parler japonais ?", "ja"),
        ("On peut parler en coréen ?", "ko"),
        ("Faisons du japonais", "ja"),
        ("J'aimerais apprendre le coréen", "ko"),
        ("En japonais, s'il te plaît", "ja"),
        ("Pas de souci, on passe au japonais", "ja"),
        ("Hoću da pređem na japanski", "ja"),
        ("Pričaj na japanskom", "ja"),
        ("Možemo li da pričamo korejski?", "ko"),
        ("Dạy tôi tiếng Nhật đi", "ja"),
        ("Nói bằng tiếng Hàn nhé", "ko"),
        ("日本語にしよう", "ja"),
        ("韓国語でお願いします", "ko"),
        ("日本語を練習したい", "ja"),
        ("일본어로 말해 줘", "ja"),
        ("일본어 연습하고 싶어요", "ja"),
        ("我们用日语聊吧", "ja"),
        ("我想学韩语", "ko"),
    ],
)
def test_more_requests_in_the_languages_taught(turn: str, code: str) -> None:
    # Serbian as the current language, so French requests can switch too.
    assert requested_language(turn, "sr") == code


@pytest.mark.parametrize(
    "turn",
    [
        "Je ne veux pas passer au japonais",
        "Comment dit-on bonjour en japonais ?",
        "J'apprends le japonais à l'école",
        "Ne želim da pređem na japanski",
        "Kako se kaže zdravo na japanskom?",
        "Tôi không muốn học tiếng Nhật",
        "Đừng nói tiếng Nhật",
        "日本語で話したくない",
        "日本語を勉強しています",
        "일본어로 하지 마",
        "일본어로 뭐라고 해요?",
        "我不想说日语",
        "别说日语",
        "用日语怎么说你好？",
    ],
)
def test_refusals_and_questions_in_the_languages_taught_are_not_a_switch(turn: str) -> None:
    assert requested_language(turn, "sr") is None


def test_native_names_are_for_exported_prompt_languages() -> None:
    # Native names cover the first six languages and the most studied others,
    # not all 84: the rest are matched by their English names.
    from session_config import load_prompts

    from language_switch import NATIVE_NAMES

    prompts = set(load_prompts())
    assert set(NATIVE_NAMES) <= prompts
    assert {"zh", "ko", "fr", "ja", "sr", "vi"} <= set(NATIVE_NAMES)


@pytest.mark.parametrize(
    ("turn", "code"),
    [
        ("Parlons allemand", "de"),
        ("我想学西班牙语", "es"),
        ("러시아어로 바꿔 주세요", "ru"),
        ("イタリア語で話しましょう", "it"),
        ("Pričajmo nemački", "de"),
        ("Chuyển sang tiếng Thái nhé", "th"),
    ],
)
def test_requests_for_the_most_studied_other_languages(turn: str, code: str) -> None:
    assert requested_language(turn, "fr") == code
