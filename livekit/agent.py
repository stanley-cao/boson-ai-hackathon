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

from dotenv import load_dotenv
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobRequest, cli
from livekit.plugins import boson

from avatar_output import is_avatar_room, route_audio_to_avatar
from session_config import load_session, model_kwargs
from tools import build_tools

logger = logging.getLogger("polyglot")

load_dotenv(override=True)

SESSION = load_session()

# The identity this agent joins every room as. server/avatar.ts names it as the
# avatar session's publisher_identity, and the avatar only plays audio from
# there (#33). LiveKit would otherwise pick "agent-<job id>".
AGENT_IDENTITY = "polyglot-tutor"


class Tutor(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SESSION["instructions"], tools=build_tools(SESSION))

    async def on_enter(self) -> None:
        # The model answers when the learner stops speaking. Speak first instead,
        # which is also what probe.py waits for.
        self.session.generate_reply(instructions="Greet the learner in one short sentence.")


server = AgentServer()


async def accept_as_tutor(request: JobRequest) -> None:
    await request.accept(identity=AGENT_IDENTITY)


@server.rtc_session(on_request=accept_as_tutor)
async def entrypoint(ctx: JobContext) -> None:
    options = model_kwargs(SESSION)
    # Environment overrides, as upstream has, for trying another model or voice.
    options["model"] = os.getenv("BOSON_REALTIME_MODEL", options["model"])
    options["voice"] = os.getenv("BOSON_VOICE", options["voice"])
    session = AgentSession(
        llm=boson.realtime.RealtimeModel(
            url=os.getenv("BOSON_REALTIME_URL", "wss://api.boson.ai/v1/realtime/"),
            api_key=os.environ["BOSON_API_KEY"],
            **options,
        ),
    )
    if is_avatar_room(ctx.room.name):
        # Set this before start(): RoomIO sees an existing output and does not
        # publish the agent's normal audio track. Realtime PCM goes to the
        # avatar, whose synchronized audio/video tracks are what the learner
        # subscribes to. AgentSession clears this sink automatically on barge-in.
        route_audio_to_avatar(session, ctx.room)
    await session.start(agent=Tutor(), room=ctx.room)


if __name__ == "__main__":
    cli.run_app(server)
