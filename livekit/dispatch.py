"""Which agent a learner room asks for.

The token server (agentNameFor in server/avatar.ts) puts this name in each
learner token's room configuration, and the agent registers under it, so a
room only ever goes to the agent started on the same machine. Without a name
LiveKit hands rooms to any agent registered to the project: with a team on
one project, live sessions landed on a teammate's laptop running other code.
"""

import os
import re
import socket

from livekit import api


def agent_name(env: dict[str, str] | None = None, host: str | None = None) -> str:
    """POLYGLOT_AGENT_NAME, or ``polyglot-tutor-<host>``, as agentNameFor computes it."""
    env = os.environ if env is None else env
    explicit = env.get("POLYGLOT_AGENT_NAME", "").strip()
    if explicit:
        return explicit
    host = socket.gethostname() if host is None else host
    slug = re.sub(r"[^a-z0-9]+", "-", host.lower()).strip("-")
    return f"polyglot-tutor-{slug or 'local'}"


def room_config(name: str | None = None) -> api.RoomConfiguration:
    """The room configuration that dispatches this machine's agent, for test clients."""
    return api.RoomConfiguration(agents=[api.RoomAgentDispatch(agent_name=name or agent_name())])
