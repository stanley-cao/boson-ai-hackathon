"""Unit tests for the agent-to-avatar audio route (#34). No room or keys."""

from types import SimpleNamespace
from typing import Any

from livekit import rtc

import avatar_output


class FakeDataStreamAudioOutput:
    def __init__(self, room: Any, **kwargs: Any) -> None:
        self.room = room
        self.kwargs = kwargs


def test_routes_24khz_pcm_to_the_avatar_participant(monkeypatch: Any) -> None:
    monkeypatch.setattr(avatar_output, "DataStreamAudioOutput", FakeDataStreamAudioOutput)
    room = object()
    session = SimpleNamespace(output=SimpleNamespace(audio=None))

    output = avatar_output.route_audio_to_avatar(session, room)  # type: ignore[arg-type]

    assert session.output.audio is output
    assert output.room is room
    assert output.kwargs == {
        "destination_identity": "polyglot-avatar",
        "sample_rate": 24_000,
        "wait_remote_track": rtc.TrackKind.KIND_AUDIO,
    }


def test_transport_constants_match_the_avatar_session_contract() -> None:
    assert avatar_output.AVATAR_IDENTITY == "polyglot-avatar"
    assert avatar_output.AVATAR_AUDIO_RATE == 24_000


def test_only_server_created_avatar_rooms_use_the_avatar_sink() -> None:
    assert avatar_output.is_avatar_room("polyglot-012345abcdef")
    assert not avatar_output.is_avatar_room("probe-01234567")
    assert not avatar_output.is_avatar_room("")
