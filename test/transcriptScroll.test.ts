import { describe, expect, it } from "vitest";
import { isNearTranscriptBottom } from "../src/ui/TranscriptPanel";

describe("transcript auto-follow", () => {
  it("follows while the reader is at or near the latest message", () => {
    expect(isNearTranscriptBottom({ scrollHeight: 800, scrollTop: 400, clientHeight: 400 })).toBe(true);
    expect(isNearTranscriptBottom({ scrollHeight: 800, scrollTop: 310, clientHeight: 400 })).toBe(true);
  });

  it("stops following when the reader scrolls up", () => {
    expect(isNearTranscriptBottom({ scrollHeight: 800, scrollTop: 200, clientHeight: 400 })).toBe(false);
  });

  it("accepts a custom follow threshold", () => {
    const panel = { scrollHeight: 800, scrollTop: 350, clientHeight: 400 };
    expect(isNearTranscriptBottom(panel, 40)).toBe(false);
    expect(isNearTranscriptBottom(panel, 50)).toBe(true);
  });
});
