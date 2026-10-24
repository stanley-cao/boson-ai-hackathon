// Replaying a study card's text through the server's `POST /api/tts` route.
//
// The browser sends only `{ input }`; the route adds the model and the real key
// server-side (see server/index.ts), so nothing here ever sees a credential.

export const REPLAY_MESSAGES = {
  tooLong: "Too long to replay",
  notConfigured: "Replay isn't set up on the server",
  playFailed: "Couldn't play audio",
  generic: "Couldn't load audio",
} as const;

/** A replay failure whose `message` is short enough to show on the card. */
export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

/** Maps the route's JSON `error` codes to card copy. */
export function replayErrorMessage(code: unknown): string {
  switch (code) {
    case "input_too_long":
      return REPLAY_MESSAGES.tooLong;
    case "tts_not_configured":
      return REPLAY_MESSAGES.notConfigured;
    default:
      return REPLAY_MESSAGES.generic;
  }
}

/** Fetches WAV audio for `text`. Throws only `ReplayError`. */
export async function fetchSpeech(text: string, fetchImpl: typeof fetch = fetch): Promise<Blob> {
  let res: Response;
  try {
    res = await fetchImpl("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text }),
    });
  } catch {
    throw new ReplayError(REPLAY_MESSAGES.generic);
  }

  if (!res.ok) {
    // Errors are JSON by design, but a proxy (e.g. Vite with the server down)
    // can answer with an HTML or empty body, so don't trust the shape.
    let code: unknown;
    try {
      code = ((await res.json()) as { error?: unknown }).error;
    } catch {
      code = undefined;
    }
    throw new ReplayError(replayErrorMessage(code));
  }

  try {
    return await res.blob();
  } catch {
    throw new ReplayError(REPLAY_MESSAGES.generic);
  }
}

// Every TTS call is billed and takes a moment, and learners tap the same card
// repeatedly, so audio is fetched once per distinct text for the page's life.
// Promises are cached (not URLs) so a double-tap during loading shares a fetch.
const urlCache = new Map<string, Promise<string>>();

export function speechUrl(
  text: string,
  fetchImpl: typeof fetch = fetch,
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): Promise<string> {
  const cached = urlCache.get(text);
  if (cached) return cached;

  const pending = fetchSpeech(text, fetchImpl).then(createUrl);
  urlCache.set(text, pending);
  // A failure is evicted so the learner's retry actually refetches.
  pending.catch(() => urlCache.delete(text));
  return pending;
}

// Only one replay plays at a time; overlapping clips are unintelligible.
let stopCurrent: (() => void) | null = null;

/**
 * Plays `text`, calling `onStart` once audio is audible. Resolves when the clip
 * ends or is cut off by a newer replay; rejects with `ReplayError`.
 *
 * `play()` runs after an await, outside the click's call stack. Chrome allows
 * that once the page has had any user gesture, which the mic button guarantees.
 */
export async function playReplay(text: string, onStart?: () => void): Promise<void> {
  const url = await speechUrl(text);
  stopCurrent?.();

  const audio = new Audio(url);
  await new Promise<void>((resolve, reject) => {
    const release = () => {
      if (stopCurrent === stop) stopCurrent = null;
    };
    const stop = () => {
      audio.pause();
      release();
      resolve();
    };
    const fail = () => {
      release();
      reject(new ReplayError(REPLAY_MESSAGES.playFailed));
    };

    stopCurrent = stop;
    audio.addEventListener("ended", stop, { once: true });
    audio.addEventListener("error", fail, { once: true });
    // A newer replay may have cut this one off before play() settled; starting
    // then would leave this card stuck on "playing".
    audio.play().then(() => {
      if (stopCurrent === stop) onStart?.();
    }, fail);
  });
}
