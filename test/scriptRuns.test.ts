import { describe, expect, it } from "vitest";
import { segmentByScript } from "../src/lang/scriptRuns";

describe("segmentByScript", () => {
  it("handles empty and single-script text", () => {
    expect(segmentByScript("")).toEqual([]);
    expect(segmentByScript("hello")).toEqual([{ script: "latin", text: "hello" }]);
    expect(segmentByScript("学生")).toEqual([{ script: "han", text: "学生" }]);
  });

  it("splits mixed Han and Latin text into contiguous runs", () => {
    expect(segmentByScript("I am 学生")).toEqual([
      { script: "latin", text: "I" },
      { script: "neutral", text: " " },
      { script: "latin", text: "am" },
      { script: "neutral", text: " " },
      { script: "han", text: "学生" },
    ]);
  });

  it("keeps punctuation, numbers, whitespace, and emoji neutral", () => {
    expect(segmentByScript("你好, 123 👋 hi!")).toEqual([
      { script: "han", text: "你好" },
      { script: "neutral", text: ", 123 👋 " },
      { script: "latin", text: "hi" },
      { script: "neutral", text: "!" },
    ]);
  });

  it("recognises accented Latin and keeps combining marks with their base", () => {
    expect(segmentByScript("café cafe\u0301")).toEqual([
      { script: "latin", text: "café" },
      { script: "neutral", text: " " },
      { script: "latin", text: "cafe\u0301" },
    ]);
  });

  it("preserves every input character exactly", () => {
    const text = "English + 中文 42 🌏 cafe\u0301";
    expect(segmentByScript(text).map((run) => run.text).join("")).toBe(text);
  });
});
