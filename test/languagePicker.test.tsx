import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TARGET_LANGUAGE_CODES } from "../src/lang/profiles";
import { LanguagePicker } from "../src/ui/LanguagePicker";

describe("LanguagePicker", () => {
  it("renders each target profile and marks the current selection", () => {
    const html = renderToStaticMarkup(
      <LanguagePicker value="ko" onChange={vi.fn()} />,
    );

    expect(html).toContain('aria-label="Practice language"');
    for (const code of TARGET_LANGUAGE_CODES) expect(html).toContain(`value="${code}"`);
    expect(html).toContain('<option value="ko" selected="">Korean</option>');
    expect(html).toContain("Mandarin Chinese");
    expect(html).toContain("French");
    expect(html).toContain("Japanese");
  });

  it("can be disabled while a session is active", () => {
    const html = renderToStaticMarkup(
      <LanguagePicker value="zh" disabled onChange={vi.fn()} />,
    );
    expect(html).toContain("disabled=\"\"");
  });
});
