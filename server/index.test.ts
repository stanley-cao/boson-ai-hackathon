import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, TTS_MAX_INPUT_CHARS } from "./index";

const servers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    ),
  );
});

async function start(options: Parameters<typeof createApp>[0]): Promise<string> {
  const server = createApp(options).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("POST /api/tts", () => {
  it("calls Higgs TTS with the server key and returns WAV audio", async () => {
    const audio = new Uint8Array([82, 73, 70, 70]);
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(audio, { status: 200, headers: { "Content-Type": "audio/wav" } }),
    );
    const base = await start({ apiKey: "server-secret", baseUrl: "https://boson.test", fetchImpl: upstream });

    const response = await fetch(`${base}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: " 你好 " }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(audio);
    expect(upstream).toHaveBeenCalledOnce();

    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("https://boson.test/v1/audio/speech");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer server-secret",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "higgs-tts-3",
      input: "你好",
      voice: "eleanor",
      response_format: "wav",
    });
  });

  it("rejects missing and over-limit input without calling Boson", async () => {
    const upstream = vi.fn<typeof fetch>();
    const base = await start({ apiKey: "server-secret", fetchImpl: upstream });

    const missing = await fetch(`${base}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "   " }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "input_required" });

    const tooLong = await fetch(`${base}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "a".repeat(TTS_MAX_INPUT_CHARS + 1) }),
    });
    expect(tooLong.status).toBe(413);
    expect(await tooLong.json()).toEqual({
      error: "input_too_long",
      max_chars: TTS_MAX_INPUT_CHARS,
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns JSON errors without exposing the key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rejected = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("upstream detail", { status: 429, statusText: "Too Many Requests" }),
    );
    const configured = await start({ apiKey: "server-secret", fetchImpl: rejected });
    const upstreamError = await fetch(`${configured}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });
    expect(upstreamError.status).toBe(429);
    expect(await upstreamError.json()).toEqual({ error: "tts_upstream_error", status: 429 });

    const unconfigured = await start({ apiKey: "", fetchImpl: vi.fn<typeof fetch>() });
    const noKey = await fetch(`${unconfigured}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });
    expect(noKey.status).toBe(500);
    const body = await noKey.text();
    expect(JSON.parse(body)).toEqual({ error: "tts_not_configured" });
    expect(body).not.toContain("server-secret");
  });

  it("maps malformed JSON and network failures to JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));
    const base = await start({ apiKey: "server-secret", fetchImpl: unavailable });

    const malformed = await fetch(`${base}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_json" });

    const networkError = await fetch(`${base}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });
    expect(networkError.status).toBe(502);
    expect(await networkError.json()).toEqual({ error: "tts_unavailable" });
  });
});
