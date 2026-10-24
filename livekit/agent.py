"""The Polyglot tutor as a LiveKit voice agent, on Higgs Realtime.

    learner audio ──► LiveKit room ──► Higgs Realtime ──► avatar data stream
                                                               │
                                                               ▼
                                                      lip-synced A/V tracks

The prompt, voice, turn detection, transcription and tool schemas all come
from shared/session.json (`npm run export-config`), so this agent and the
browser's direct-WebSocket mode run the same tutor. LiveKit is here because
Higgs Avatar only joins LiveKit Cloud rooms (Phase 4).

    uv run agent.py dev         # join rooms on LIVEKIT_URL; talk to it in the Agents Playground
"""

import logging
import os
from typing import Any

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    AgentStateChangedEvent,
    ConversationItemAddedEvent,
    JobContext,
    JobRequest,
    RunContext,
    UserStateChangedEvent,
    cli,
)
from livekit.plugins import boson

from avatar_output import is_avatar_room, route_audio_to_avatar
from session_config import (
    instructions_for,
    load_prompts,
    load_session,
    model_kwargs,
    practice_change,
    turn_transcription,
)
from tools import build_tools

logger = logging.getLogger("polyglot")

load_dotenv(override=True)

SESSION = load_session()
PROMPTS = load_prompts()

# The identity this agent joins every room as. server/avatar.ts names it as the
# avatar session's publisher_identity, and the avatar only plays audio from
# there (#33). LiveKit would otherwise pick "agent-<job id>".
AGENT_IDENTITY = "polyglot-tutor"


class Tutor(Agent):
    def __init__(self, instructions: str) -> None:
        super().__init__(instructions=instructions, tools=build_tools(SESSION, self.after_tool))

    async def after_tool(self, name: str, result: dict[str, Any], context: RunContext) -> None:
        # The browser's study panel follows set_practice_language on its own,
        # but the prompt carries the language's teaching notes, so a switch
        # needs new instructions here too, as RealtimeClient.ts sends in
        # direct mode. Awaited before the result goes back, so the reply
        # already uses them.
        instructions = practice_change(name, result, PROMPTS)
        if instructions is not None and instructions != self.instructions:
            detail = result.get("detail", {})
            logger.info("now practising %s at %s level", detail.get("language"), detail.get("level"))
            await self.update_instructions(instructions)

    async def on_enter(self) -> None:
        # The model answers when the learner stops speaking. Speak first instead,
        # which is also what probe.py waits for.
        self.session.generate_reply(instructions="Greet the learner in one short sentence.")


def reset_transcription_language_each_turn(
    session: AgentSession, model: boson.realtime.RealtimeModel
) -> None:
    """Keep STT on the session's own hint, so captions show the language actually spoken.

    Boson otherwise lets transcription follow the tutor's language after its
    first reply: with Serbian picked, the learner's English came back as
    Serbian. Mirrors RealtimeClient.ts: reset once the tutor's reply is over
    and again as the learner starts speaking. The model-level update reaches
    every open session; the prompt and target language are left alone.
    """
    reset = turn_transcription(SESSION)

    def on_agent_state(event: AgentStateChangedEvent) -> None:
        if event.old_state == "speaking":
            model.update_options(input_audio_transcription=reset)

    def on_user_state(event: UserStateChangedEvent) -> None:
        if event.new_state == "speaking":
            model.update_options(input_audio_transcription=reset)

    session.on("agent_state_changed", on_agent_state)
    session.on("user_state_changed", on_user_state)


def log_conversation(session: AgentSession) -> None:
    """Log each turn as it lands in the chat context, for debugging live sessions.

    The browser's transcript is gone once the room closes; this keeps what the
    model actually saw (including interrupted, truncated replies) in the
    agent's log.
    """

    def on_item(event: ConversationItemAddedEvent) -> None:
        item = event.item
        role = getattr(item, "role", None)
        if role is None:
            return
        interrupted = " (interrupted)" if getattr(item, "interrupted", False) else ""
        logger.info("%s%s: %s", role, interrupted, getattr(item, "text_content", None))

    session.on("conversation_item_added", on_item)


server = AgentServer()


async def accept_as_tutor(request: JobRequest) -> None:
    await request.accept(identity=AGENT_IDENTITY)


@server.rtc_session(on_request=accept_as_tutor)
async def entrypoint(ctx: JobContext) -> None:
    # The learner's token carries the language and level picked in the
    # browser (server/avatar.ts), so wait for them before choosing a prompt.
    # They are always first in the room: the avatar is only added after.
    await ctx.connect()
    learner = await ctx.wait_for_participant()
    instructions = instructions_for(learner.metadata, PROMPTS, SESSION["instructions"])
    logger.info("tutoring %s with metadata %r", learner.identity, learner.metadata)
    options = model_kwargs(SESSION)
    options["instructions"] = instructions
    # Environment overrides, as upstream has, for trying another model or voice.
    options["model"] = os.getenv("BOSON_REALTIME_MODEL", options["model"])
    options["voice"] = os.getenv("BOSON_VOICE", options["voice"])
    model = boson.realtime.RealtimeModel(
        url=os.getenv("BOSON_REALTIME_URL", "wss://api.boson.ai/v1/realtime/"),
        api_key=os.environ["BOSON_API_KEY"],
        **options,
    )
    session = AgentSession(llm=model)
    reset_transcription_language_each_turn(session, model)
    log_conversation(session)
    if is_avatar_room(ctx.room.name):
        # Set this before start(): RoomIO sees an existing output and does not
        # publish the agent's normal audio track. Realtime PCM goes to the
        # avatar, whose synchronized audio/video tracks are what the learner
        # subscribes to. AgentSession clears this sink automatically on barge-in.
        route_audio_to_avatar(session, ctx.room)
    await session.start(agent=Tutor(instructions), room=ctx.room)


if __name__ == "__main__":
    cli.run_app(server)
