/**
 * This is where your agent will live.
 *
 * During the workshop you'll define a `ToolLoopAgent` here, give it a model
 * and instructions, and later add tools (web search, sandbox, etc.). The
 * route handler in `app/api/chat/route.ts` and the `useChat` call in
 * `components/agent-chat.tsx` will both import from this file.
 *
 * Workshop docs: https://agent-foundations-certification.vercel.app/docs/chat-agent
 */

import { WorkflowAgent } from "@ai-sdk/workflow";
import { isStepCount } from "ai";
import { companyModel } from "@/lib/model";
import { SHOP_AGENT_INSTRUCTIONS } from "@/lib/prompts";
import { shopTools } from "@/lib/tools";

/** Hard cap on model/tool rounds per answer, so a loop can't run away. */
const MAX_STEPS = 8;

export function createShopAgent() {
  return new WorkflowAgent({
    // Our own OpenAI-compatible provider (see lib/model.ts), not AI Gateway.
    model: companyModel("shop"),
    instructions: SHOP_AGENT_INSTRUCTIONS,
    tools: shopTools,
    stopWhen: isStepCount(MAX_STEPS),
    maxRetries: 3,
  });
}
