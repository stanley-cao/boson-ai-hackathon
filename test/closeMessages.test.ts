import { describe, expect, it } from "vitest";
import { describeClose } from "../src/realtime/events";

describe("friendly realtime close messages", () => {
  it.each([
    [3000, "Your session expired. Reconnect to start a fresh one.", false],
    [4429, "Voice chat is paused by this account's billing limit. Check the account balance, then reconnect.", false],
    [1013, "The tutor is busy right now. Please try again in a moment.", true],
  ] as const)("maps close code %i to an actionable message", (code, message, retryable) => {
    expect(describeClose(code, "technical server reason")).toEqual({
      code,
      reason: "technical server reason",
      message,
      retryable,
    });
    expect(message).not.toContain(String(code));
  });
});
