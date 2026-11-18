/**
 * Reconnect to an admin chat run (page refresh, dropped connection). Admin
 * only. Only `adminChatFlow` runs are served here: a shopping run id, or an
 * unknown one, is a 404, so this route can't be used to read other runs.
 */
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse } from "ai";
import { getRun } from "workflow/api";
import { requireAdmin } from "@/lib/admin-guard";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;

  const raw = new URL(request.url).searchParams.get("startIndex") ?? "0";
  const startIndex = Number(raw);
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json(
      { error: "invalid_request", message: "startIndex must be a non-negative integer." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const run = getRun(id);
  const known = await run.exists.catch(() => false);
  const name = known ? await run.workflowName.catch(() => "") : "";
  if (!known || !name.includes("adminChatFlow")) {
    return Response.json(
      { error: "not_found", message: "No such admin chat run." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const stream = run
    .getReadable({ startIndex: 0 })
    .pipeThrough(createModelCallToUIChunkTransform({ uiStartIndex: startIndex }));

  return createUIMessageStreamResponse({
    stream,
    headers: { "x-workflow-run-id": id, "cache-control": "no-store" },
  });
}
