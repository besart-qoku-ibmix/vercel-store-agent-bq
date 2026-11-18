/**
 * This is where we'll add a route for resuming a stream for an agent chat.
 *
 * During the workshop you will wire this up in the Workflows chapter.
 *
 * Workshop docs: https://agent-foundations-certification.vercel.app/docs/workflows
 */

import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse } from "ai";
import { getRun } from "workflow/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const raw = new URL(request.url).searchParams.get("startIndex") ?? "0";
  const startIndex = Number(raw);
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json(
      { error: "invalid_request", message: "startIndex must be a non-negative integer." },
      { status: 400 },
    );
  }

  const run = getRun(id);
  const known = await run.exists.catch(() => false);
  const name = known ? await run.workflowName.catch(() => "") : "";
  if (!known || !name.includes("chatFlow")) {
    return Response.json({ error: "not_found", message: "No such chat run." }, { status: 404 });
  }

  const stream = run
    .getReadable({ startIndex: 0 })
    .pipeThrough(createModelCallToUIChunkTransform({ uiStartIndex: startIndex }));

  return createUIMessageStreamResponse({
    stream,
    headers: { "x-workflow-run-id": id },
  });
}
