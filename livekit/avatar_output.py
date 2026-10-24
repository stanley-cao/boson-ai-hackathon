"""Route the LiveKit agent's speech through the Higgs Avatar data protocol."""

from typing import TYPE_CHECKING

from livekit import rtc
from livekit.agents.voice.avatar import DataStreamAudioOutput

if TYPE_CHECKING:
    from livekit.agents import AgentSession


# Must match server/avatar.ts, which gives the avatar this identity and names
# the agent as its publisher. Keeping the transport constants here makes the
# wiring independently testable without a room or Boson credentials.
AVATAR_IDENTITY = "polyglot-avatar"
AVATAR_AUDIO_RATE = 24_000
AVATAR_ROOM_PREFIX = "polyglot-"


def is_avatar_room(room_name: str) -> bool:
    """Whether the room came from the Phase 4 avatar session endpoint."""
    return room_name.startswith(AVATAR_ROOM_PREFIX)


def route_audio_to_avatar(session: "AgentSession", room: rtc.Room) -> DataStreamAudioOutput:
    """Replace the normal agent track with the avatar's PCM data-stream sink.

    AgentSession forwards every realtime audio frame into this output and
    calls ``clear_buffer`` when learner speech interrupts a reply. The adapter
    implements both sides of Boson's avatar protocol: ``lk.audio_stream`` PCM
    chunks and the ``lk.clear_buffer`` RPC.
    """
    output = DataStreamAudioOutput(
        room,
        destination_identity=AVATAR_IDENTITY,
        sample_rate=AVATAR_AUDIO_RATE,
        # Waiting for the avatar's audio track means playback callbacks and the
        # media subscription are ready before the first greeting is streamed.
        wait_remote_track=rtc.TrackKind.KIND_AUDIO,
    )
    session.output.audio = output
    return output
