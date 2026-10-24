import { describe, expect, it } from "vitest";
import { interruptedAssistantItem } from "../src/realtime/turnInterruption";

describe("interruptedAssistantItem", () => {
  it("does not truncate the previous reply when a normal new turn starts", () => {
    expect(interruptedAssistantItem(false, "assistant-previous")).toBeNull();
  });

  it("returns the assistant item that is still playing on real barge-in", () => {
    expect(interruptedAssistantItem(true, "assistant-current")).toBe("assistant-current");
  });

  it("does not invent a truncation target before an assistant item exists", () => {
    expect(interruptedAssistantItem(true, null)).toBeNull();
  });
});
