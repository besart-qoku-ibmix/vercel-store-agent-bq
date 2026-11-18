/**
 * Durable admin chat: one workflow run per employee message.
 *
 * Same shape as the shopping chat flow (lib/workflows/chat-flow.ts): the
 * client owns the history and sends it with each request, model calls and
 * tool calls run as steps that retry on transient failures, and everything is
 * written to the run's durable stream so a refreshed page can reconnect to the
 * same run instead of starting a new one.
 *
 * Extra for admin: before the agent runs, a step reads the memory file from
 * the admin sandbox (application code, not the model) and the agent is built
 * with those notes in its instructions.
 *
 * The workflow only orchestrates; all I/O happens inside steps.
 */
import { type ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { createAdminAgent } from "@/lib/admin-agent";
import { loadAdminContextStep } from "@/lib/workflows/steps/admin-steps";

export async function adminChatFlow(messages: UIMessage[]) {
  "use workflow";

  const context = await loadAdminContextStep();
  const agent = createAdminAgent(context);
  await agent.stream({
    messages: await convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
    }),
    writable: getWritable<ModelCallStreamPart>(),
  });
}
