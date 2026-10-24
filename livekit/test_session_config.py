"""Unit tests for the agent's config loading and tool schemas. No network, no keys."""

import asyncio
from pathlib import Path
from typing import Any

import pytest

from session_config import instructions_for, load_prompts, load_session, model_kwargs
from tools import STAND_IN_SUMMARY, build_tools


@pytest.fixture(scope="module")
def session() -> dict[str, Any]:
    return load_session()


def test_model_kwargs_match_the_exported_session(session: dict[str, Any]) -> None:
    kwargs = model_kwargs(session)
    assert kwargs["instructions"] == session["instructions"]
    assert kwargs["voice"] == "eleanor"
    assert kwargs["output_modalities"] == ["audio"]
    # #7: learners pause mid-sentence; the plugin's default window is 500 ms.
    assert kwargs["turn_detection"] == {"type": "server_vad", "silence_duration_ms": 1500}
    assert kwargs["input_audio_transcription_model"] == "higgs-stt-3.1"


def test_transcription_uses_native_language_hint(session: dict[str, Any]) -> None:
    assert model_kwargs(session)["input_audio_transcription_language"] == "en"


def test_missing_export_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_session(tmp_path / "session.json")


def test_one_tool_per_schema(session: dict[str, Any]) -> None:
    tools = build_tools(session)
    assert [tool.info.name for tool in tools] == [schema["name"] for schema in session["tools"]]
    first = tools[0].info.raw_schema
    assert first["parameters"] == session["tools"][0]["parameters"]
    assert first["description"] == session["tools"][0]["description"]


def test_non_function_schemas_are_skipped() -> None:
    assert build_tools({"tools": [{"type": "mcp", "name": "x", "parameters": {}}]}) == []
    assert build_tools({}) == []


def test_stand_in_handler_answers_with_a_summary(session: dict[str, Any]) -> None:
    tool = build_tools(session)[0]
    # Odd arguments still get an answer: the model hangs on an unanswered call_id.
    result = asyncio.run(tool({"language": "ZH-cn", "unexpected": True}, None))  # type: ignore[arg-type]
    assert result == {"summary": STAND_IN_SUMMARY}


def test_plugin_sends_the_browsers_audio_config(session: dict[str, Any]) -> None:
    # What the plugin will put in its session.update, which is what reaches the
    # server. Private, but it is the one place the language invariant is visible.
    from livekit.plugins import boson

    opts = boson.realtime.RealtimeModel(api_key="bai-test", **model_kwargs(session))._boson_opts
    assert opts.turn_detection == session["audio"]["input"]["turn_detection"]
    assert opts.input_audio_transcription == session["audio"]["input"]["transcription"]
    assert opts.input_audio_transcription["language"] == "en"


def test_instructions_follow_the_learners_choice(session: dict[str, Any]) -> None:
    prompts = load_prompts()
    chosen = instructions_for('{"language": "ko", "level": "intermediate"}', prompts, session["instructions"])
    assert chosen == prompts["ko"]["intermediate"]
    assert "Korean" in chosen


@pytest.mark.parametrize("metadata", ["", "not json", "[]", '{"language": "xx", "level": "beginner"}'])
def test_instructions_fall_back_to_the_default(session: dict[str, Any], metadata: str) -> None:
    # Playground and probe.py participants have no metadata; that isn't an error.
    assert instructions_for(metadata, load_prompts(), session["instructions"]) == session["instructions"]
