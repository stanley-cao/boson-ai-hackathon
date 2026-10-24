"""The tutor's tools, built from the JSON schemas in shared/session.json.

In the browser, src/tools/registry.ts runs these and feeds the study panel.
In LiveKit mode the tool calls arrive here, in the agent, instead. Until #32
forwards them to the browser over LiveKit RPC, each one is logged and answered
with a stand-in result, because the model waits on every call_id and hangs
if one never gets an output (CLAUDE.md: tools never throw).
"""

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from livekit.agents import RunContext
from livekit.agents.llm import RawFunctionTool, function_tool

logger = logging.getLogger("polyglot.tools")

# What the model may say aloud, like ToolResult.summary in src/tools/handlers.ts.
# Neutral on purpose: each tool's description already tells the model what to
# say after the call, and a stand-in result should not change that.
STAND_IN_SUMMARY = "Done. Continue as the tool's description says."

ToolHandler = Callable[[dict[str, Any], RunContext], Awaitable[dict[str, Any]]]


def stand_in_handler(name: str) -> ToolHandler:
    """A handler that records the call and returns a result without running anything."""

    async def handle(raw_arguments: dict[str, Any], context: RunContext) -> dict[str, Any]:
        logger.info("%s(%s)", name, json.dumps(raw_arguments, ensure_ascii=False))
        return {"summary": STAND_IN_SUMMARY}

    return handle


def build_tools(session: dict[str, Any]) -> list[RawFunctionTool]:
    """One LiveKit tool per exported schema, with the schema passed through unchanged."""
    return [
        function_tool(
            stand_in_handler(schema["name"]),
            raw_schema={
                "name": schema["name"],
                "description": schema.get("description", ""),
                "parameters": schema["parameters"],
            },
        )
        for schema in session.get("tools", [])
        if schema.get("type") == "function"
    ]
