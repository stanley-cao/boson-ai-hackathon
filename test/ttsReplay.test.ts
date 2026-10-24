import { describe, expect, it, vi } from "vitest";
import { fetchSpeech, REPLAY_MESSAGES, speechUrl } from "../src/ui/ttsReplay";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("fetchSpeech", () => {
  it("posts only the text to /api/tts and returns the audio", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response(new Uint8Array([1, 2, 3])));

    const blob = await fetchSpeech("加油", fetchImpl as typeof fetch);

    expect(blob.size).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith("/api/tts", expect.objectContaining({ method: "POST" }));
    const init = fetchImpl.mock.calls[0][1];
    expect(JSON.parse(init.body as string)).toEqual({ input: "加油" });
  });

  it("maps a route error code to card copy", async () => {
    const fetchImpl = async () => jsonResponse(413, { error: "input_too_long", max_chars: 500 });

    await expect(fetchSpeech("x", fetchImpl)).rejects.toThrow(REPLAY_MESSAGES.tooLong);
  });

  it("falls back to the generic message for network and non-JSON failures", async () => {
    const offline = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };
    const htmlError = async () => new Response("<html>Bad Gateway</html>", { status: 502 });

    await expect(fetchSpeech("x", offline)).rejects.toThrow(REPLAY_MESSAGES.generic);
    await expect(fetchSpeech("x", htmlError)).rejects.toThrow(REPLAY_MESSAGES.generic);
  });
});

describe("speechUrl", () => {
  it("fetches each text once", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1])));
    const createUrl = () => "blob:cached";

    await speechUrl("再见", fetchImpl as typeof fetch, createUrl);
    const url = await speechUrl("再见", fetchImpl as typeof fetch, createUrl);

    expect(url).toBe("blob:cached");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure, so a retry refetches", async () => {
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(502, { error: "tts_upstream_error" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1])));
    const createUrl = () => "blob:retried";

    await expect(speechUrl("谢谢", fetchImpl as typeof fetch, createUrl)).rejects.toThrow(
      REPLAY_MESSAGES.generic,
    );
    await expect(speechUrl("谢谢", fetchImpl as typeof fetch, createUrl)).resolves.toBe(
      "blob:retried",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
