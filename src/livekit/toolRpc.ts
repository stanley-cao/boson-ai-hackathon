import { SERVER, type ServerEvent } from "../realtime/events";
import { CLIENT_TOOL_RESULT } from "../state/transcriptStore";
import { runTool } from "../tools/registry";
import type { ToolResult } from "../tools/handlers";
import { QuizController } from "../quiz/controller";

/**
 * Tool calls in LiveKit mode (#32).
 *
 * The agent owns the Higgs Realtime session there, so the model's tool calls
 * reach it rather than the browser. It forwards each one here over LiveKit RPC
 * (livekit/tools.py); we run it through the same registry as the direct
 * WebSocket and answer with the ToolResult, which the agent hands back to the
 * model.
 *
 * Request payload: {call_id, name, arguments}. Response: the ToolResult as JSON.
 */
export const TOOL_RPC_METHOD = "polyglot.run_tool";

/**
 * The part of livekit-client's LocalParticipant this needs. Structural, so this
 * file doesn't pull in livekit-client before the room UI (#35) does.
 */
export interface ToolRpcParticipant {
  registerRpcMethod(method: string, handler: (data: { payload: string }) => Promise<string>): void;
  unregisterRpcMethod(method: string): void;
}

interface ToolRpcRequest {
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
}

function parseRequest(payload: string): ToolRpcRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const { call_id, name, arguments: args } = value as Record<string, unknown>;
  if (typeof call_id !== "string" || !call_id || typeof name !== "string" || !name) return null;
  const isObject = args !== null && typeof args === "object" && !Array.isArray(args);
  return { call_id, name, arguments: isObject ? (args as Record<string, unknown>) : {} };
}

/**
 * Run one forwarded call and return the response payload.
 *
 * The transcript sees the same two events as in direct-WebSocket mode — the
 * call, then `client.tool_result` — so the study panel works unchanged. The
 * call is a server event there; here we emit it ourselves, since no Realtime
 * events reach the browser in LiveKit mode. Never throws: a malformed request
 * still gets a ToolResult, which the agent passes on to the model.
 */
export async function answerToolRpc(
  payload: string,
  onServerEvent: (evt: ServerEvent) => void,
  quizController?: QuizController,
): Promise<string> {
  const request = parseRequest(payload);
  if (!request) {
    const result: ToolResult = { summary: "The tool call could not be read.", error: "bad_request" };
    return JSON.stringify(result);
  }
  const { call_id, name } = request;
  const args = name === "grade_quiz_answer" && quizController
    ? quizController.prepareGradeArgs(request.arguments)
    : request.arguments;
  onServerEvent({
    type: SERVER.functionCallArgsDone,
    call_id,
    name,
    item_id: call_id,
    arguments: JSON.stringify(args),
  });
  const startedAt = Date.now();
  let result = await runTool(name, args);
  if (name === "grade_quiz_answer" && quizController) {
    result = quizController.accept(result).result;
  }
  onServerEvent({ type: CLIENT_TOOL_RESULT, call_id, result, ms: Date.now() - startedAt });
  return JSON.stringify(result);
}

/**
 * Answer the agent's tool calls in this room. Returns a function that stops.
 * Call it as soon as the room connects: until then the agent's calls fall back
 * to a stand-in result and never reach the study panel.
 */
export function registerToolRpc(
  participant: ToolRpcParticipant,
  onServerEvent: (evt: ServerEvent) => void,
  quizController?: QuizController,
): () => void {
  participant.registerRpcMethod(TOOL_RPC_METHOD, ({ payload }) =>
    answerToolRpc(payload, onServerEvent, quizController));
  return () => participant.unregisterRpcMethod(TOOL_RPC_METHOD);
}
