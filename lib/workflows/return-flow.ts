/**
 * Background return workflow. Started by the returnOrder tool, which answers
 * the shopper as soon as the run exists; everything below keeps going after
 * the chat has replied.
 *
 * Order of work, each as its own step (see steps/return-steps.ts):
 *   load order -> notify customer -> pre-authorize refund -> file return
 * then wait for the store's decision. Because every step result is saved, a
 * retry of "file return" replays the saved notification and pre-authorization
 * instead of repeating them.
 *
 * The store calls our webhook when it has decided (15-60 s). The webhook is
 * only a signal: the decision is always read back from the store API, so a
 * forged call to the public webhook URL cannot change the outcome. If the
 * webhook never arrives (for example local dev, where the store cannot reach
 * localhost) the workflow falls back to polling GET /returns/{id}.
 *
 * Workflow functions must stay deterministic: all I/O is in steps.
 */
import { createWebhook, sleep } from "workflow";
import type { ReturnProgress, ReturnWorkflowInput } from "@/lib/shop/types";
import {
  checkReturnStep,
  fileReturnStep,
  loadOrderStep,
  notifyCustomerStep,
  preauthorizeRefundStep,
  publishFiledStep,
} from "@/lib/workflows/steps/return-steps";

const FIRST_WAIT = "90s";
const POLL_EVERY = "15s";
const MAX_POLLS = 8;

export async function returnFlow(input: ReturnWorkflowInput): Promise<ReturnProgress> {
  "use workflow";

  const order = await loadOrderStep(input.orderId);
  await notifyCustomerStep(input.orderId);
  await preauthorizeRefundStep(input.orderId);

  using webhook = createWebhook();
  // Register the webhook before handing its URL to the store.
  await webhook.getConflict();

  const filed = await fileReturnStep({
    orderId: input.orderId,
    items: input.items,
    reason: input.reason,
    callback: webhook.url,
  });
  await publishFiledStep(filed.id);

  // Wake on the store's callback, or after a while if it never comes.
  await Promise.race([webhook, sleep(FIRST_WAIT)]);

  let state = await checkReturnStep(filed.id);
  for (let i = 0; i < MAX_POLLS && !state.decision; i++) {
    await sleep(POLL_EVERY);
    state = await checkReturnStep(filed.id);
  }

  return {
    stage: "completed",
    returnId: filed.id,
    decision: state.decision,
    refundAmount: state.refundAmount,
    currency: order.currency,
    notes: state.notes,
  };
}
