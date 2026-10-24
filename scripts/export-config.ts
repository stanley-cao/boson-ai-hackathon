// Writes the browser's session config to shared/session.json, so the Python
// LiveKit agent (livekit/) runs with exactly the same prompt, voice, VAD,
// transcription and tool schemas. Re-run after changing any of them;
// test/exportConfig.test.ts fails while the committed file is stale.
//
// Usage: npm run export-config
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSessionConfig, buildTutorPrompts, SLOW_PACE_NOTE } from "../src/realtime/sessionConfig";

const shared = resolve(dirname(fileURLToPath(import.meta.url)), "../shared");

function write(name: string, value: unknown): void {
  const out = resolve(shared, name);
  writeFileSync(out, JSON.stringify(value, null, 2) + "\n");
  console.log(`wrote ${out}`);
}

mkdirSync(shared, { recursive: true });
// Only the `session` object, at the default pair, level and pace: the agent's
// plugin builds its own session.update around it.
write("session.json", buildSessionConfig().session);
// The prompt for every target language and level, so the agent can run the
// pair the learner picked in the browser (avatar mode).
write("prompts.json", buildTutorPrompts());
// The sentence a slow pace appends to any of those prompts, so the agent can
// slow down for "speak more slowly" as the browser does (set_speaking_pace).
write("pace.json", { slow_note: SLOW_PACE_NOTE });
