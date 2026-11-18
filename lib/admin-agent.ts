import { WorkflowAgent } from "@ai-sdk/workflow";
import { isStepCount } from "ai";
import { adminTools } from "@/lib/admin-tools";
import { buildAdminInstructions } from "@/lib/admin/prompts";
import type { AdminContext } from "@/lib/admin/types";
import { companyModel } from "@/lib/model";

/**
 * The store admin agent. Separate from the shopping agent in lib/agent.ts:
 * its own model role, prompt and tools (back-office data, sandbox, memory).
 * Shopping code never imports this file.
 */

/** Admin analysis needs more rounds: fetch two datasets, compute, answer. */
const MAX_STEPS = 14;

export function createAdminAgent(context: AdminContext) {
  return new WorkflowAgent({
    // Our own OpenAI-compatible provider (see lib/model.ts), not AI Gateway.
    model: companyModel("admin"),
    instructions: buildAdminInstructions(context),
    tools: adminTools,
    stopWhen: isStepCount(MAX_STEPS),
    maxRetries: 3,
  });
}
