"""The Polyglot tutor as a LiveKit voice agent, on Higgs Realtime.

    learner audio ──► LiveKit room ──► Higgs Realtime ──► LiveKit room ──► learner

The prompt, voice, turn detection, transcription and tool schemas all come
from shared/session.json (`npm run export-config`), so this agent and the
browser's direct-WebSocket mode run the same tutor. LiveKit is here because
Higgs Avatar only joins LiveKit Cloud rooms (Phase 4).

    uv run agent.py dev         # join rooms on LIVEKIT_URL; talk to it in the Agents Playground
"""

import logging
import os

from dotenv import load_dotenv
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli
from livekit.plugins import boson

from session_config import load_session, model_kwargs
from tools import build_tools

logger = logging.getLogger("polyglot")

load_dotenv(override=True)

SESSION = load_session()


class Tutor(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=SESSION["instructions"], tools=build_tools(SESSION))

    async def on_enter(self) -> None:
        # The model answers when the learner stops speaking. Speak first instead,
        # which is also what probe.py waits for.
        self.session.generate_reply(instructions="Greet the learner in one short sentence.")


server = AgentServer()


@server.rtc_session()
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
    await session.start(agent=Tutor(), room=ctx.room)


if __name__ == "__main__":
    cli.run_app(server)
