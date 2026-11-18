import { getRun } from "workflow/api";
import type { ReturnProgress } from "@/lib/shop/types";

/**
 * Progress of a background return, polled by the return card in the chat.
 * Read-only: it looks at an existing run and never starts or repeats work.
 * Only return runs are served, so a shopper can't use it to inspect any
 * other workflow run.
 */

const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;

const idle: ReturnProgress = {
  stage: "running",
  returnId: null,
  decision: null,
  refundAmount: null,
  currency: null,
  notes: null,
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const headers = { "cache-control": "no-store" };
  if (!RUN_ID.test(runId)) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers });
  }

  const run = getRun(runId);
  const known = await run.exists.catch(() => false);
  const name = known ? await run.workflowName.catch(() => "") : "";
  if (!known || !name.includes("returnFlow")) {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }

  const status = await run.status;

  if (status === "completed") {
    const result = (await run.returnValue) as ReturnProgress;
    return Response.json(result, { headers });
  }
  if (status === "failed" || status === "cancelled") {
    return Response.json({ ...idle, stage: "failed" } satisfies ReturnProgress, { headers });
  }

  // Pending or running: has the return been filed yet? The workflow publishes
  // the store's return id once it has been filed.
  let returnId: string | null = null;
  try {
    const readable = run.getReadable<{ returnId: string }>({ namespace: "progress" });
    if ((await readable.getTailIndex()) >= 0) {
      const reader = readable.getReader();
      const first = await reader.read();
      await reader.cancel().catch(() => {});
      returnId = first.value?.returnId ?? null;
    }
  } catch {
    returnId = null;
  }

  const progress: ReturnProgress = returnId
    ? { ...idle, stage: "awaiting_decision", returnId }
    : idle;
  return Response.json(progress, { headers });
}
