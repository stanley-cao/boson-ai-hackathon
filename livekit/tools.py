"""The tutor's tools, built from the JSON schemas in shared/session.json.

In the browser's direct-WebSocket mode, src/tools/registry.ts runs these and
feeds the study panel. In LiveKit mode the tool calls arrive here, in the
agent, instead, so each one is forwarded to the learner's browser over LiveKit
RPC: the browser runs the same registry and answers with its ToolResult, and
the study panel fills in exactly as it does without LiveKit (#32).

Every path answers, because the model waits on every call_id and hangs if one
never gets an output (CLAUDE.md: tools never throw).
"""

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from livekit import rtc
from livekit.agents import RunContext
from livekit.agents.llm import RawFunctionTool, function_tool

logger = logging.getLogger("polyglot.tools")

# The browser registers this method (src/livekit/toolRpc.ts). The request is
# {call_id, name, arguments}; the response is the ToolResult as JSON.
TOOL_RPC_METHOD = "polyglot.run_tool"
# Handlers finish in milliseconds; this only bounds a browser that went quiet.
RPC_TIMEOUT_S = 5.0

# What the model may say aloud, like ToolResult.summary in src/tools/handlers.ts.
# Neutral on purpose: each tool's description already tells the model what to
# say after the call, and a stand-in result should not change that.
STAND_IN_SUMMARY = "Done. Continue as the tool's description says."
UNAVAILABLE_SUMMARY = "The study panel did not answer, so nothing was saved. Carry on the conversation."

ToolHandler = Callable[[dict[str, Any], RunContext], Awaitable[dict[str, Any]]]
# Runs after the browser answers and before the model gets the result, so a
# session change it makes (new instructions) is in place for the reply.
AfterTool = Callable[[str, dict[str, Any], dict[str, Any], RunContext], Awaitable[None]]


def _as_tool_result(response: str) -> dict[str, Any] | None:
    """The browser's answer, if it is a ToolResult: an object with a string summary."""
    try:
        result = json.loads(response)
    except ValueError:
        return None
    if isinstance(result, dict) and isinstance(result.get("summary"), str):
        return result
    return None


async def forward_tool_call(
    local: rtc.LocalParticipant | None,
    browser_identity: str | None,
    call_id: str,
    name: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """Run one tool call in the learner's browser and return its ToolResult."""
    if local is None or browser_identity is None:
        # No learner has joined yet; nothing to forward to.
        return {"summary": STAND_IN_SUMMARY}
    payload = json.dumps({"call_id": call_id, "name": name, "arguments": arguments}, ensure_ascii=False)
    try:
        response = await local.perform_rpc(
            destination_identity=browser_identity,
            method=TOOL_RPC_METHOD,
            payload=payload,
            response_timeout=RPC_TIMEOUT_S,
        )
    except rtc.RpcError as e:
        if e.code == rtc.RpcError.ErrorCode.UNSUPPORTED_METHOD:
            # The Agents Playground and probe.py (without --tools) join without
            # the method; they get the stand-in, as before #32.
            logger.info("%s: %s has no %s; using the stand-in", name, browser_identity, TOOL_RPC_METHOD)
            return {"summary": STAND_IN_SUMMARY}
        logger.warning("%s: RPC to %s failed: %s %s", name, browser_identity, e.code, e.message)
        return {"summary": UNAVAILABLE_SUMMARY, "error": "tool_unavailable"}
    except Exception:
        logger.exception("%s: RPC to %s failed", name, browser_identity)
        return {"summary": UNAVAILABLE_SUMMARY, "error": "tool_unavailable"}

    result = _as_tool_result(response)
    if result is None:
        logger.warning("%s: %s answered with something other than a ToolResult: %r", name, browser_identity, response)
        return {"summary": UNAVAILABLE_SUMMARY, "error": "tool_unavailable"}
    return result


def forwarding_handler(name: str, after: AfterTool | None = None) -> ToolHandler:
    """A handler that forwards the call to the learner's browser."""

    async def handle(raw_arguments: dict[str, Any], context: RunContext) -> dict[str, Any]:
        logger.info("%s(%s)", name, json.dumps(raw_arguments, ensure_ascii=False))
        local: rtc.LocalParticipant | None = None
        identity: str | None = None
        call_id = name
        try:
            # The linked participant is the learner, not whichever remote joined
            # first: from Phase 4 the avatar is in the room too.
            room_io = context.session.room_io
            participant = room_io.linked_participant
            if participant is not None:
                local, identity = room_io.room.local_participant, participant.identity
            # The model's own call_id, so the browser's tool item matches it.
            call_id = context.function_call.call_id
        except Exception:
            # No session or room (unit tests, or a session still starting).
            pass
        result = await forward_tool_call(local, identity, call_id, name, raw_arguments)
        logger.info("%s -> %s", name, result.get("summary"))
        if after is not None:
            try:
                await after(name, raw_arguments, result, context)
            except Exception:
                # The model still needs its answer, whatever went wrong here.
                logger.exception("%s: after-tool hook failed", name)
        return result

    return handle


def build_tools(session: dict[str, Any], after: AfterTool | None = None) -> list[RawFunctionTool]:
    """One LiveKit tool per exported schema, with the schema passed through unchanged."""
    return [
        function_tool(
            forwarding_handler(schema["name"], after),
            raw_schema={
                "name": schema["name"],
                "description": schema.get("description", ""),
                "parameters": schema["parameters"],
            },
        )
        for schema in session.get("tools", [])
        if schema.get("type") == "function"
    ]
