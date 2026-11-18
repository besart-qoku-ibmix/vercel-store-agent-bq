/**
 * This is where the admin chat API route will live.
 *
 * During the workshop you'll wire this up to the agent in `lib/agent.ts`
 * using `createAgentUIStreamResponse` from the AI SDK. The chat panel in
 * `components/agent-chat.tsx` posts here once you swap its placeholder
 * `useState` for `useChat`.
 *
 * Workshop docs: https://agent-foundations-certification.vercel.app/docs/admin-chat-agent
 */

import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { start } from "workflow/api";
import { requireAdmin } from "@/lib/admin-guard";
import { adminChatFlow } from "@/lib/workflows/admin-chat-flow";

const MAX_MESSAGES = 60;
const MAX_TEXT_LENGTH = 4000;
const MAX_BODY_BYTES = 1024 * 1024;

function bad(message: string, status = 400) {
  return Response.json(
    { error: "invalid_request", message },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function isMessage(value: unknown): value is UIMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as { id?: unknown; role?: unknown; parts?: unknown };
  return (
    typeof m.id === "string" &&
    (m.role === "user" || m.role === "assistant") &&
    Array.isArray(m.parts) &&
    m.parts.every((p) => p && typeof p === "object" && typeof (p as { type?: unknown }).type === "string")
  );
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return bad("That conversation is too long.", 413);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("Send a JSON body with a messages array.");
  }

  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return bad("Send at least one message.");
  }
  if (messages.length > MAX_MESSAGES) {
    return bad("That conversation is too long. Please start a new chat.");
  }
  if (!messages.every(isMessage)) return bad("Those messages aren't valid.");

  const last = messages[messages.length - 1];
  if (last.role !== "user") return bad("The last message must be from the employee.");

  // Employee text is trimmed and capped. Assistant parts (including tool
  // results the model saw before) are kept so follow-ups have context.
  const cleaned: UIMessage[] = messages.map((m) =>
    m.role === "user"
      ? {
          ...m,
          parts: m.parts
            .filter((p) => p.type === "text")
            .map((p) => ({
              ...p,
              text: String((p as { text?: unknown }).text ?? "").slice(0, MAX_TEXT_LENGTH),
            })) as UIMessage["parts"],
        }
      : m,
  );
  const lastText = cleaned[cleaned.length - 1].parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
  if (!lastText) return bad("Type a message first.");

  const run = await start(adminChatFlow, [cleaned]);

  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId, "cache-control": "no-store" },
  });
}
