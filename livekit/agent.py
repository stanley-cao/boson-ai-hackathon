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

import asyncio
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
from loop_guard import strip_repeats
from session_config import (
    instructions_for,
    load_prompts,
    load_session,
    load_slow_note,
    model_kwargs,
    pace_request,
    practice_change,
    turn_transcription,
    with_pace,
)
from tools import build_tools

logger = logging.getLogger("polyglot")

load_dotenv(override=True)

SESSION = load_session()
PROMPTS = load_prompts()
SLOW_NOTE = load_slow_note()

# The identity this agent joins every room as. server/avatar.ts names it as the
# avatar session's publisher_identity, and the avatar only plays audio from
# there (#33). LiveKit would otherwise pick "agent-<job id>".
AGENT_IDENTITY = "polyglot-tutor"


class Tutor(Agent):
    def __init__(self, instructions: str) -> None:
        super().__init__(instructions=instructions, tools=build_tools(SESSION, self.after_tool))
        # The prompt for the language and level, before any pace note.
        self.base_instructions = instructions
        # The lasting pace ("speak more slowly") and whether a one-off slow
        # repeat is due to end, as RealtimeClient.ts tracks them.
        self.session_pace = "normal"
        self.revert_pace_on_next_turn = False

    async def after_tool(
        self, name: str, arguments: dict[str, Any], result: dict[str, Any], context: RunContext
    ) -> None:
        # The browser runs the tools in avatar mode, but the side effects that
        # RealtimeClient.ts applies in direct mode live in the prompt, so they
        # happen here. Awaited before the result goes back, so the reply that
        # follows already uses the new instructions.
        instructions = practice_change(name, result, PROMPTS)
        if instructions is not None and instructions != self.base_instructions:
            # The prompt carries the language's teaching notes and the level's
            # scaffolding, so a switch needs new instructions.
            detail = result.get("detail", {})
            logger.info("now practising %s at %s level", detail.get("language"), detail.get("level"))
            self.base_instructions = instructions
            await self.set_pace(self.session_pace)
        elif name == "set_speaking_pace" and not result.get("error"):
            pace, scope = pace_request(arguments)
            if scope == "session":
                self.session_pace = pace
                self.revert_pace_on_next_turn = False
            elif self.session_pace != "slow":
                # Avatar mode has no TTS replay: the avatar has to say the
                # slow repeat itself, so slow down for one reply and go back
                # once the learner speaks again.
                self.revert_pace_on_next_turn = True
            logger.info("speaking pace %s (%s)", pace, scope)
            await self.set_pace(pace)

    async def set_pace(self, pace: str) -> None:
        await self.update_instructions(with_pace(self.base_instructions, pace, SLOW_NOTE))

    async def end_one_off_pace(self) -> None:
        """Back to the lasting pace once a one-off slow repeat has been said."""
        if self.revert_pace_on_next_turn:
            self.revert_pace_on_next_turn = False
            await self.set_pace(self.session_pace)

    async def on_enter(self) -> None:
        # The model answers when the learner stops speaking. Speak first instead,
        # which is also what probe.py waits for.
        self.session.generate_reply(instructions="Greet the learner in one short sentence.")


def reset_transcription_language_each_turn(session: AgentSession) -> None:
    """Keep STT on the session's own hint, so captions show the language actually spoken.

    Boson otherwise lets transcription follow the tutor's language after its
    first reply: with Serbian picked, the learner's English came back as
    Serbian. Mirrors RealtimeClient.ts: reset once the tutor's reply is over
    and again as the learner starts speaking.

    Only the transcription field is sent, as the browser's
    buildTranscriptionDetectionReset does. The plugin's update_options would
    resend the whole session (prompt and tools included) twice a turn; the
    repeating-one-line loops were first seen with that, though probes could
    not pin them on it.
    """
    event = {
        "type": "session.update",
        "session": {"audio": {"input": {"transcription": turn_transcription(SESSION)}}},
    }

    def reset() -> None:
        try:
            session.current_agent.realtime_llm_session.send_event(dict(event))
        except RuntimeError:
            # No agent or realtime session yet (starting up) or any more (closing).
            pass

    def on_agent_state(event: AgentStateChangedEvent) -> None:
        if event.old_state == "speaking":
            reset()

    def on_user_state(event: UserStateChangedEvent) -> None:
        if event.new_state == "speaking":
            reset()

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


def guard_against_loops(session: AgentSession) -> None:
    """Strip repeated sentences from each reply the model will see again.

    See loop_guard.py: the learner has already heard the repeat, but taking it
    out of the context stops the model copying it into every later reply. The
    plugin sends the edit as a delete and re-create of that one item.
    """

    async def strip(item_id: str) -> None:
        agent = session.current_agent
        ctx = agent.chat_ctx.copy()
        messages = [m for m in ctx.items if m.type == "message"]
        index = next((i for i, m in enumerate(messages) if m.id == item_id), None)
        if index is None:
            return
        reply = messages[index]
        earlier = [m.text_content or "" for m in messages[:index] if m.role == "assistant"]
        learner = next((m.text_content for m in reversed(messages[:index]) if m.role == "user"), None)
        stripped = strip_repeats(reply.text_content or "", earlier, learner)
        if stripped is None:
            return
        logger.info("loop guard: keeping %r of %r", stripped, reply.text_content)
        # A new message rather than an edit: copy() shares item objects with
        # the agent's own context, and the diff would then see no change.
        ctx.items[ctx.index_by_id(item_id)] = reply.model_copy(
            update={"content": [stripped] if stripped else []}
        )
        await agent.update_chat_ctx(ctx)

    def on_item(event: ConversationItemAddedEvent) -> None:
        item = event.item
        if getattr(item, "role", None) != "assistant" or not getattr(item, "text_content", None):
            return
        task = asyncio.create_task(strip(item.id))
        # A failed edit only leaves the repeat in context; log it, never raise.
        task.add_done_callback(
            lambda t: t.cancelled() or t.exception() is None or logger.warning("loop guard failed: %r", t.exception())
        )

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
    reset_transcription_language_each_turn(session)
    log_conversation(session)
    guard_against_loops(session)
    if is_avatar_room(ctx.room.name):
        # Set this before start(): RoomIO sees an existing output and does not
        # publish the agent's normal audio track. Realtime PCM goes to the
        # avatar, whose synchronized audio/video tracks are what the learner
        # subscribes to. AgentSession clears this sink automatically on barge-in.
        route_audio_to_avatar(session, ctx.room)
    tutor = Tutor(instructions)

    def on_user_state(event: UserStateChangedEvent) -> None:
        # The learner's next turn starts after the slow repeat was said, and
        # before the reply to it is generated.
        if event.new_state == "speaking":
            asyncio.create_task(tutor.end_one_off_pace())

    session.on("user_state_changed", on_user_state)
    await session.start(agent=tutor, room=ctx.room)


if __name__ == "__main__":
    cli.run_app(server)
