"""Unit tests for forwarding tool calls to the browser over RPC (#32). No network, no keys."""

import asyncio
import json
from types import SimpleNamespace
from typing import Any

from livekit import rtc

from tools import (
    RPC_TIMEOUT_S,
    STAND_IN_SUMMARY,
    TOOL_RPC_METHOD,
    UNAVAILABLE_SUMMARY,
    forward_tool_call,
    forwarding_handler,
)

ARGS = {"language": "zh", "phrase": "加油", "meaning": "keep going"}
SAVED = {"summary": "Saved 加油.", "detail": {"type": "phrase", "language": "zh", "phrase": "加油", "meaning": "keep going"}}


class FakeLocal:
    """Stands in for rtc.LocalParticipant: records the RPC, then answers or raises."""

    def __init__(self, answer: str | Exception) -> None:
        self.answer = answer
        self.calls: list[dict[str, Any]] = []

    async def perform_rpc(self, **kwargs: Any) -> str:
        self.calls.append(kwargs)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def forward(local: FakeLocal | None, identity: str | None = "learner") -> dict[str, Any]:
    return asyncio.run(forward_tool_call(local, identity, "call_1", "save_phrase", ARGS))  # type: ignore[arg-type]


def test_forwards_the_call_and_returns_the_browsers_result() -> None:
    local = FakeLocal(json.dumps(SAVED, ensure_ascii=False))
    assert forward(local) == SAVED
    [call] = local.calls
    assert call["destination_identity"] == "learner"
    assert call["method"] == TOOL_RPC_METHOD
    assert call["response_timeout"] == RPC_TIMEOUT_S
    assert json.loads(call["payload"]) == {"call_id": "call_1", "name": "save_phrase", "arguments": ARGS}


def test_no_browser_yet_gets_the_stand_in() -> None:
    assert forward(None, None) == {"summary": STAND_IN_SUMMARY}


def test_a_participant_without_the_method_gets_the_stand_in() -> None:
    # The Agents Playground and probe.py join without registering the method.
    local = FakeLocal(rtc.RpcError(rtc.RpcError.ErrorCode.UNSUPPORTED_METHOD, "Method not supported"))
    assert forward(local) == {"summary": STAND_IN_SUMMARY}


def test_a_failed_rpc_still_answers_with_an_error() -> None:
    for error in (
        rtc.RpcError(rtc.RpcError.ErrorCode.RESPONSE_TIMEOUT, "Response timeout"),
        rtc.RpcError(rtc.RpcError.ErrorCode.RECIPIENT_DISCONNECTED, "Recipient disconnected"),
        RuntimeError("room closed"),
    ):
        assert forward(FakeLocal(error)) == {"summary": UNAVAILABLE_SUMMARY, "error": "tool_unavailable"}, error


def test_an_answer_that_is_not_a_tool_result_is_an_error() -> None:
    for answer in ("not json", "[]", json.dumps({"detail": {}}), json.dumps({"summary": 3})):
        assert forward(FakeLocal(answer))["error"] == "tool_unavailable", answer


def test_handler_sends_the_models_call_id_to_the_linked_participant() -> None:
    local = FakeLocal(json.dumps(SAVED))
    context = SimpleNamespace(
        session=SimpleNamespace(
            room_io=SimpleNamespace(
                linked_participant=SimpleNamespace(identity="learner"),
                room=SimpleNamespace(local_participant=local),
            )
        ),
        function_call=SimpleNamespace(call_id="call_from_model"),
    )
    assert asyncio.run(forwarding_handler("save_phrase")(ARGS, context)) == SAVED  # type: ignore[arg-type]
    assert json.loads(local.calls[0]["payload"])["call_id"] == "call_from_model"


def test_handler_without_a_linked_participant_gets_the_stand_in() -> None:
    context = SimpleNamespace(
        session=SimpleNamespace(room_io=SimpleNamespace(linked_participant=None, room=None)),
        function_call=SimpleNamespace(call_id="c"),
    )
    assert asyncio.run(forwarding_handler("save_phrase")(ARGS, context)) == {"summary": STAND_IN_SUMMARY}  # type: ignore[arg-type]
