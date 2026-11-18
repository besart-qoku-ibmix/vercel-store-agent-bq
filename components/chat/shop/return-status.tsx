"use client";

import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Hourglass,
  LoaderCircle,
  MessageSquareMore,
  PackageCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReturnOrderData, ReturnProgress } from "@/lib/shop/types";
import { safePrice } from "@/components/chat/shop/format";

const POLL_INTERVAL_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 6;

type PollState =
  | { kind: "polling"; progress: ReturnProgress | null }
  | { kind: "done"; progress: ReturnProgress }
  | { kind: "stale" }; // stopped polling (timeout / repeated errors) without a final answer

function isProgress(value: unknown): value is ReturnProgress {
  if (!value || typeof value !== "object") return false;
  const stage = (value as { stage?: unknown }).stage;
  return (
    stage === "running" ||
    stage === "awaiting_decision" ||
    stage === "completed" ||
    stage === "failed"
  );
}

/**
 * Polls GET /api/returns/{runId} while mounted. Stops on completed/failed,
 * backs off on errors, gives up after ~10 minutes, and cleans up on unmount.
 * The poll never creates or repeats work: it is a read of an existing run.
 */
function useReturnProgress(runId: string): PollState {
  const [state, setState] = useState<PollState>({ kind: "polling", progress: null });

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let errors = 0;
    let stopped = false;

    const schedule = (delay: number) => {
      if (stopped) return;
      timer = setTimeout(tick, delay);
    };

    async function tick() {
      if (stopped) return;
      if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
        setState((prev) =>
          prev.kind === "polling" ? { kind: "stale" } : prev,
        );
        return;
      }
      // Don't poll from a hidden tab; check again shortly.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        schedule(POLL_INTERVAL_MS);
        return;
      }
      try {
        const response = await fetch(`/api/returns/${encodeURIComponent(runId)}`, {
          signal: controller.signal,
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const body: unknown = await response.json();
        if (!isProgress(body)) throw new Error("unexpected response");
        errors = 0;
        if (stopped) return;
        if (body.stage === "completed" || body.stage === "failed") {
          setState({ kind: "done", progress: body });
          return;
        }
        setState({ kind: "polling", progress: body });
        schedule(POLL_INTERVAL_MS);
      } catch (error) {
        if (stopped || (error instanceof DOMException && error.name === "AbortError")) return;
        errors += 1;
        if (errors >= MAX_CONSECUTIVE_ERRORS) {
          setState((prev) => (prev.kind === "polling" ? { kind: "stale" } : prev));
          return;
        }
        schedule(Math.min(POLL_INTERVAL_MS * 2 ** errors, MAX_BACKOFF_MS));
      }
    }

    // First check immediately so a refreshed page shows the real stage fast.
    schedule(0);

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  return state;
}

/**
 * Result of returnOrder. The return workflow has already started, so this
 * confirms "Return filed" immediately, then shows live progress. It only says
 * a refund was approved when the decision is "approved".
 */
export function ReturnStatus({ data }: { data: ReturnOrderData }) {
  const state = useReturnProgress(data.returnRunId);
  const progress = state.kind === "stale" ? null : state.progress;
  const stage = describeStage(state, data);

  // Announce stage changes politely; the first render is the initial value.
  const lastAnnounced = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (lastAnnounced.current !== stage.title) {
      if (lastAnnounced.current !== null) setAnnouncement(`Return update: ${stage.title}.`);
      lastAnnounced.current = stage.title;
    }
  }, [stage.title]);

  const itemCount = data.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <section
      aria-label={`Return for order ${data.orderId}`}
      className="w-full overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex items-start gap-3 border-b border-border p-4">
        <PackageCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-foreground" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Return filed</h3>
          <p className="text-sm text-muted-foreground">
            {`Order #${data.orderId}`}
            {itemCount > 0 ? `, ${itemCount} item${itemCount === 1 ? "" : "s"}` : ""}
            {Number.isFinite(data.orderTotal)
              ? `, order total ${safePrice(data.orderTotal, data.currency)}`
              : ""}
          </p>
        </div>
      </div>

      <div className="space-y-2 p-4">
        <div className={cn("flex items-start gap-3", stage.tone === "bad" && "text-destructive")}>
          <span aria-hidden="true" className="mt-0.5 shrink-0">
            {stage.icon}
          </span>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground">{stage.title}</p>
            <p className="text-sm text-muted-foreground">{stage.detail}</p>
            {progress?.decision === "approved" && progress.refundAmount != null ? (
              <p className="text-sm font-medium text-foreground">
                {`Approved refund: ${safePrice(progress.refundAmount, progress.currency ?? data.currency)}`}
              </p>
            ) : null}
            {progress?.notes &&
            (progress.decision === "needs_info" || progress.decision === "rejected") ? (
              <p className="whitespace-pre-line text-sm text-muted-foreground">{progress.notes}</p>
            ) : null}
          </div>
        </div>
        {progress?.returnId ? (
          <p className="text-xs text-muted-foreground">{`Return reference: ${progress.returnId}`}</p>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

interface StageView {
  title: string;
  detail: string;
  tone: "neutral" | "good" | "bad";
  icon: React.ReactNode;
}

function describeStage(state: PollState, data: ReturnOrderData): StageView {
  if (state.kind === "stale") {
    return {
      title: "Status unavailable",
      detail:
        "I can't check the latest status right now. Ask again in a few minutes for an update.",
      tone: "neutral",
      icon: <Clock className="size-4" />,
    };
  }

  const progress = state.progress;
  const spin = "size-4 animate-spin motion-reduce:animate-none";

  if (!progress || progress.stage === "running") {
    return {
      title: "In progress",
      detail: `Your return for order #${data.orderId} is being processed. You can keep chatting while this runs.`,
      tone: "neutral",
      icon: <LoaderCircle className={spin} />,
    };
  }

  if (progress.stage === "awaiting_decision") {
    return {
      title: "Waiting for a decision",
      detail: "Your return was submitted and is under review. This can take a minute or two.",
      tone: "neutral",
      icon: <Hourglass className="size-4" />,
    };
  }

  if (progress.stage === "failed") {
    return {
      title: "Couldn't complete",
      detail:
        "We couldn't finish this return automatically. Please contact support and mention this order number.",
      tone: "bad",
      icon: <CircleAlert className="size-4" />,
    };
  }

  // completed
  switch (progress.decision) {
    case "approved":
      return {
        title: "Approved",
        detail: "Your return was approved.",
        tone: "good",
        icon: <CircleCheck className="size-4" />,
      };
    case "rejected":
      return {
        title: "Rejected",
        detail: "Your return was not approved. No refund will be issued for it.",
        tone: "bad",
        icon: <CircleX className="size-4" />,
      };
    case "needs_info":
      return {
        title: "Needs more information",
        detail: "The store needs more information before it can decide on this return.",
        tone: "neutral",
        icon: <MessageSquareMore className="size-4" />,
      };
    default:
      return {
        title: "Completed",
        detail: "The return finished processing, but no decision was reported. Please contact support if you expected one.",
        tone: "neutral",
        icon: <Clock className="size-4" />,
      };
  }
}
