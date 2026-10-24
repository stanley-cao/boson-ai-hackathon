import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import dotenv from "dotenv";
import { OUTPUT_VOICE } from "../src/realtime/sessionConfig";

dotenv.config();

const PORT = Number(process.env.PORT ?? 3000);
const BOSON_BASE_URL = process.env.BOSON_BASE_URL ?? "https://api.boson.ai";

// How long a minted ephemeral key stays valid. The API accepts 10–7200 seconds
// and defaults to 600. Short is good: the key is handed to a browser, and a
// fresh one is minted for every connection anyway.
const EPHEMERAL_TTL_SECONDS = 600;
export const TTS_MAX_INPUT_CHARS = 500;

/**
 * The API key comes from BOSON_API_KEY, or from a file whose path is in
 * BOSON_API_KEY_FILE. Reading it from a file keeps the secret out of your shell
 * history and out of .env — useful if you already keep keys somewhere central.
 */
function loadApiKey(): string | undefined {
  const inline = process.env.BOSON_API_KEY?.trim();
  if (inline) return inline;

  const keyFile = process.env.BOSON_API_KEY_FILE;
  if (keyFile) {
    try {
      const fromFile = readFileSync(keyFile, "utf8").trim();
      if (fromFile) {
        console.log(`Loaded BOSON_API_KEY from ${keyFile}`);
        return fromFile;
      }
    } catch {
      console.warn(`Could not read BOSON_API_KEY_FILE at ${keyFile}`);
    }
  }
  return undefined;
}

interface AppOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createApp({
  apiKey = loadApiKey(),
  baseUrl = BOSON_BASE_URL,
  fetchImpl = fetch,
}: AppOptions = {}) {
  const app = express();
  app.use(express.json({ limit: "4kb" }));

  /**
   * GET /api/token
   *
   * This server exists for exactly one reason: your real API key must never reach
   * the browser. Anything the browser can read, a visitor can read — and a leaked
   * key is billable until you rotate it.
   *
   * So the browser asks *us* for a key, and we ask Boson for a short-lived
   * "ephemeral" one (`bai-eph-…`) using the real key. The browser gets only the
   * ephemeral value, which expires on its own in ten minutes.
   *
   * A fresh key is minted per request. Do not cache them.
   */
  app.get("/api/token", async (_req, res) => {
    if (!apiKey) {
      return res.status(500).json({
        error:
          "No API key found. Set BOSON_API_KEY in .env, or point BOSON_API_KEY_FILE at a key file.",
      });
    }

    try {
      const upstream = await fetchImpl(`${baseUrl}/v1/realtime/client_secrets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expires_after: { seconds: EPHEMERAL_TTL_SECONDS } }),
      });

      const text = await upstream.text();

      if (!upstream.ok) {
        console.error(`client_secrets failed: ${upstream.status} ${text}`);
        return res
          .status(upstream.status)
          .json({ error: `Upstream ${upstream.status}: ${text || upstream.statusText}` });
      }

      // The upstream response also carries a `session` object. The browser does
      // not need it, so we do not forward it — return the minimum.
      const data = JSON.parse(text);
      return res.json({ value: data.value, expires_at: data.expires_at });
    } catch (err) {
      console.error("Token mint error:", err);
      return res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to reach the Boson API",
      });
    }
  });

  /**
   * POST /api/tts
   *
   * The browser sends only text and receives WAV bytes. Model selection and
   * authorization stay here so the long-lived key can never appear in a
   * browser request, response, bundle, or network trace.
   */
  app.post("/api/tts", async (req, res) => {
    if (!apiKey) {
      return res.status(500).json({ error: "tts_not_configured" });
    }

    const input = typeof req.body?.input === "string" ? req.body.input.trim() : "";
    if (!input) {
      return res.status(400).json({ error: "input_required" });
    }
    if (Array.from(input).length > TTS_MAX_INPUT_CHARS) {
      return res.status(413).json({
        error: "input_too_long",
        max_chars: TTS_MAX_INPUT_CHARS,
      });
    }

    try {
      const upstream = await fetchImpl(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "higgs-tts-3",
          input,
          // The tutor's own voice: a slow repeat (#76) or a card replay in a
          // different voice sounds like a second speaker.
          voice: OUTPUT_VOICE,
          response_format: "wav",
        }),
      });

      if (!upstream.ok) {
        const detail = await upstream.text();
        console.error(`speech failed: ${upstream.status} ${detail}`);
        return res.status(upstream.status).json({
          error: "tts_upstream_error",
          status: upstream.status,
        });
      }

      const audio = Buffer.from(await upstream.arrayBuffer());
      res.set({
        "Content-Type": upstream.headers.get("content-type") ?? "audio/wav",
        "Content-Length": String(audio.length),
        "Cache-Control": "no-store",
      });
      return res.send(audio);
    } catch (err) {
      console.error("TTS error:", err);
      return res.status(502).json({ error: "tts_unavailable" });
    }
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Express otherwise returns an HTML error page for malformed or oversized
  // JSON, while every API failure in this server is deliberately JSON.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? Number((err as { status: unknown }).status)
        : 400;
    if (status === 413) {
      return res.status(413).json({ error: "request_too_large" });
    }
    return res.status(400).json({ error: "invalid_json" });
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = loadApiKey();
  createApp({ apiKey }).listen(PORT, () => {
    console.log(`Token server listening on http://localhost:${PORT}`);
    if (!apiKey) {
      console.warn(
        "  ⚠ No API key found (set BOSON_API_KEY or BOSON_API_KEY_FILE in .env) — /api/token and /api/tts will return 500.",
      );
    }
  });
}
