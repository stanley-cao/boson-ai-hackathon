"""Unit tests for agent naming. No network, no keys."""

from dispatch import agent_name, room_config


def test_the_name_matches_the_token_servers() -> None:
    # The same cases as agentNameFor in server/avatar.test.ts.
    assert agent_name({}, "Stanleys-MacBook-Air.local") == "polyglot-tutor-stanleys-macbook-air-local"
    assert agent_name({"POLYGLOT_AGENT_NAME": " demo "}, "any") == "demo"
    assert agent_name({}, "") == "polyglot-tutor-local"


def test_room_config_dispatches_that_agent() -> None:
    assert [a.agent_name for a in room_config("polyglot-tutor-x").agents] == ["polyglot-tutor-x"]
