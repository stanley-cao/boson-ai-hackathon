import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModeToggle, loadStoredMode, saveStoredMode } from "../src/ui/ModeToggle";

describe("ModeToggle", () => {
  it("offers both modes and marks the current one", () => {
    const html = renderToStaticMarkup(<ModeToggle value="avatar" onChange={vi.fn()} />);
    expect(html).toContain('aria-label="Tutor mode"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Avatar</);
    expect(html).toMatch(/aria-checked="false"[^>]*>Voice only</);
  });

  it("is disabled while a session is active", () => {
    const html = renderToStaticMarkup(<ModeToggle value="direct" disabled onChange={vi.fn()} />);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});

describe("stored mode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remembers the learner's choice", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    expect(loadStoredMode()).toBe("direct");
    saveStoredMode("avatar");
    expect(loadStoredMode()).toBe("avatar");
  });

  it("defaults to direct when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(() => saveStoredMode("avatar")).not.toThrow();
    expect(loadStoredMode()).toBe("direct");
  });
});
