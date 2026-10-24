// Answers tool calls for probe.py --tools with the browser's own code.
// One request per line on stdin, one response per line on stdout; JSON has no
// raw newlines. Run from the repo root: npx tsx livekit/tool_runner.ts
import { createInterface } from "node:readline";
import { answerToolRpc } from "../src/livekit/toolRpc";

for await (const line of createInterface({ input: process.stdin })) {
  process.stdout.write((await answerToolRpc(line, () => {})) + "\n");
}
