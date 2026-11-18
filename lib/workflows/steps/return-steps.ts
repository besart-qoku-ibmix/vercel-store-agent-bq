/**
 * Steps used by the return workflow (lib/workflows/return-flow.ts).
 *
 * Each exported function is its own durable step: it runs once, its result is
 * saved, and a later retry of a DIFFERENT step replays this saved result
 * instead of running it again. That is what keeps "notify the customer" and
 * "pre-authorize the refund" from repeating when "file the return" has to be
 * retried.
 *
 * Retry rules: transient store API failures (network, 429, 5xx) are thrown
 * as normal errors so the step retries. Anything else (400, 404, 422) is
 * deterministic, so it becomes a FatalError and retrying stops.
 *
 * No `server-only` import: steps are bundled outside Next.js, where that
 * marker package does not resolve. Nothing here reaches the browser.
 */
import { FatalError, getWritable } from "workflow";
import {
  createReturn,
  getOrder,
  getReturn,
  notifyReturnInProcess,
  preauthorizeRefund,
} from "@/lib/api";
import { isTransientError } from "@/lib/tool-errors";
import type { ReturnOrderItem } from "@/lib/shop/types";

/**
 * Rethrow transient failures (the step retries) and turn everything else into
 * a FatalError with a fixed message. Raw errors are never forwarded: their
 * text can carry the store API URL, which contains the access value.
 */
function failStep(err: unknown, what: string): never {
  if (isTransientError(err)) {
    throw new Error(`${what} failed temporarily`);
  }
  throw new FatalError(`${what} was rejected`);
}

/** Step 1: load the order again inside the workflow (the source of truth). */
export async function loadOrderStep(orderId: string) {
  "use step";
  try {
    const order = await getOrder(orderId);
    return { id: order.id, email: order.email, total: order.total, currency: order.currency };
  } catch (err) {
    return failStep(err, "Looking up the order");
  }
}

/** Step 2: tell the customer the return is being processed. */
export async function notifyCustomerStep(orderId: string) {
  "use step";
  try {
    await notifyReturnInProcess(orderId);
  } catch (err) {
    failStep(err, "Notifying the customer");
  }
}

/** Step 3: pre-authorize the refund. Returns only what later steps need. */
export async function preauthorizeRefundStep(orderId: string) {
  "use step";
  try {
    const auth = await preauthorizeRefund(orderId);
    return { id: auth.id, amount: auth.amount, currency: auth.currency };
  } catch (err) {
    return failStep(err, "Pre-authorizing the refund");
  }
}

/**
 * Step 4: file the return with the store. `callback` is the workflow webhook
 * the store calls when it has decided.
 *
 * The store API has no idempotency key for returns, so the guarantee here is
 * at the workflow level: this step's saved result is reused on replay, and
 * the tool starts at most one return workflow per order.
 */
export async function fileReturnStep(input: {
  orderId: string;
  items: ReturnOrderItem[];
  reason: string;
  callback: string;
}) {
  "use step";
  try {
    const ret = await createReturn(input);
    return { id: ret.id, status: ret.status };
  } catch (err) {
    return failStep(err, "Filing the return");
  }
}

/** Publishes "filed" so the progress route can show "waiting for a decision". */
export async function publishFiledStep(returnId: string) {
  "use step";
  const writer = getWritable<{ returnId: string }>({ namespace: "progress" }).getWriter();
  try {
    await writer.write({ returnId });
  } finally {
    writer.releaseLock();
  }
}

/** Reads the return's current state (the webhook is only a nudge, never trusted). */
export async function checkReturnStep(returnId: string) {
  "use step";
  try {
    const ret = await getReturn(returnId);
    return {
      decision: ret.decision,
      refundAmount: ret.refundAmount,
      notes: ret.notes,
    };
  } catch (err) {
    return failStep(err, "Checking the return");
  }
}
