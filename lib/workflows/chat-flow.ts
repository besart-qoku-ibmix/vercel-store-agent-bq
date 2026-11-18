/**
 * Durable shopping chat: one workflow run per user turn.
 *
 * The client owns the conversation history and sends every message with each
 * request (single-turn pattern). The agent's model calls and tool calls run
 * as steps that retry on transient failures, and everything it produces is
 * written to the run's durable stream, which is what lets a refreshed page
 * reconnect to the same run instead of starting a new one.
 *
 * The workflow only orchestrates; all I/O happens inside steps.
 */
import { type ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { createShopAgent } from "@/lib/agent";

export async function chatFlow(messages: UIMessage[]) {
  "use workflow";

  const agent = createShopAgent();
  await agent.stream({
    messages: await convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
    }),
    writable: getWritable<ModelCallStreamPart>(),
  });
}
