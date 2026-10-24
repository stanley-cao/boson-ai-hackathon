// Writes the browser's session config to shared/session.json, so the Python
// LiveKit agent (livekit/) runs with exactly the same prompt, voice, VAD,
// transcription and tool schemas. Re-run after changing any of them;
// test/exportConfig.test.ts fails while the committed file is stale.
//
// Usage: npm run export-config
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSessionConfig } from "../src/realtime/sessionConfig";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../shared/session.json");

// Only the `session` object, at the default pair, level and pace: the agent's
// plugin builds its own session.update around it.
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(buildSessionConfig().session, null, 2) + "\n");
console.log(`wrote ${out}`);
