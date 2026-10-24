import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBar } from "../src/ui/StatusBar";

describe("StatusBar", () => {
  it("announces a close message politely", () => {
    const html = renderToStaticMarkup(
      <StatusBar
        connection="closed"
        activity="idle"
        closeMessage="Your session expired. Reconnect to start a fresh one."
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Your session expired. Reconnect to start a fresh one.");
  });
});
