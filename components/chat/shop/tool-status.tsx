"use client";

import type { ReactNode } from "react";
import { CircleAlert, LoaderCircle, PackageSearch, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ToolError } from "@/lib/shop/types";
import { useShopChat } from "@/components/chat/shop/chat-context";

/**
 * Shared presentation for a tool call in progress, a tool that returned a
 * user-safe ToolError, and a tool that failed outright.
 */

export function ToolProgress({
  label,
  children,
  className,
}: {
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full flex-col gap-3", className)} aria-busy="true">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
        />
        <span>{label}</span>
      </p>
      {children}
    </div>
  );
}

const pulse = "motion-reduce:animate-none";

export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="grid w-full grid-cols-1 gap-3 min-[360px]:grid-cols-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-border bg-card">
          <Skeleton className={cn("aspect-square w-full rounded-none", pulse)} />
          <div className="space-y-2 p-3">
            <Skeleton className={cn("h-3.5 w-3/4", pulse)} />
            <Skeleton className={cn("h-3 w-1/3", pulse)} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProductDetailsSkeleton() {
  return (
    <div aria-hidden="true" className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <Skeleton className={cn("aspect-[4/3] w-full rounded-none", pulse)} />
      <div className="space-y-2 p-4">
        <Skeleton className={cn("h-4 w-2/3", pulse)} />
        <Skeleton className={cn("h-3.5 w-1/4", pulse)} />
        <Skeleton className={cn("h-3 w-full", pulse)} />
        <Skeleton className={cn("h-3 w-5/6", pulse)} />
      </div>
    </div>
  );
}

export function ChipsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("h-8 w-24 rounded-full", pulse)} />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div aria-hidden="true" className="w-full space-y-2 rounded-lg border border-border bg-card p-4">
      <Skeleton className={cn("h-4 w-1/2", pulse)} />
      <Skeleton className={cn("h-3 w-3/4", pulse)} />
      <Skeleton className={cn("h-3 w-2/3", pulse)} />
    </div>
  );
}

export interface FollowUp {
  label: string;
  /** Message sent as the shopper when the button is pressed. */
  message: string;
}

function FollowUps({ items }: { items: FollowUp[] }) {
  const { sendText, busy } = useShopChat();
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((item) => (
        <Button
          key={item.label}
          type="button"
          size="sm"
          variant="outline"
          className="h-auto min-h-8 rounded-full whitespace-normal text-left"
          disabled={busy}
          onClick={() => sendText(item.message)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Card shown for an expected failure (not found, invalid request, empty or
 * unavailable). `message` must already be user-safe text.
 */
export function ToolNotice({
  title,
  message,
  hint,
  followUps = [],
  tone = "neutral",
  icon,
}: {
  title: string;
  message?: string;
  hint?: string;
  followUps?: FollowUp[];
  tone?: "neutral" | "warning";
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full rounded-lg border bg-card p-4 text-sm",
        tone === "warning" ? "border-destructive/40" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 shrink-0",
            tone === "warning" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {icon ??
            (tone === "warning" ? (
              <CircleAlert className="size-4" />
            ) : (
              <PackageSearch className="size-4" />
            ))}
        </span>
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">{title}</p>
          {message ? <p className="text-muted-foreground">{message}</p> : null}
          {hint ? <p className="text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      <FollowUps items={followUps} />
    </div>
  );
}

/** Title per ToolError code. The message itself comes from the server (user-safe). */
function titleForError(error: ToolError["error"]): string {
  switch (error.code) {
    case "not_found":
      return "Not found";
    case "invalid_request":
      return "That request didn't work";
    case "not_eligible":
      return "Not eligible";
    case "rate_limited":
      return "The store is busy";
    case "unavailable":
      return "Store service unavailable";
    default:
      return "Something went wrong";
  }
}

/** Renders a `{ success: false }` tool result. */
export function ToolErrorCard({
  result,
  followUps = [],
  retry,
}: {
  result: ToolError;
  followUps?: FollowUp[];
  /** Follow-up that repeats the request; shown only when the error is retryable. */
  retry?: FollowUp;
}) {
  const error = result.error ?? {
    code: "unknown" as const,
    message: "",
    retryable: false,
  };
  const items = [...(error.retryable && retry ? [retry] : []), ...followUps];
  const isWarning =
    error.code === "unavailable" || error.code === "rate_limited" || error.code === "unknown";
  return (
    <ToolNotice
      title={titleForError(error)}
      message={
        typeof error.message === "string" && error.message
          ? error.message
          : "I couldn't complete that request."
      }
      hint={error.retryable ? "This is usually temporary." : undefined}
      tone={isWarning ? "warning" : "neutral"}
      icon={
        error.retryable ? <RotateCcw className="size-4" /> : undefined
      }
      followUps={items}
    />
  );
}

/**
 * Renders a tool part in the `output-error` state. Its `errorText` can contain
 * internal details, so it is never shown.
 */
export function ToolFailedCard({
  what,
  retry,
  note,
}: {
  /** e.g. "search the catalog" */
  what: string;
  retry?: FollowUp;
  /** Extra guidance when a retry could repeat a side effect. */
  note?: string;
}) {
  return (
    <ToolNotice
      title="Something went wrong"
      message={`I couldn't ${what} just now.`}
      hint={note}
      tone="warning"
      followUps={retry ? [retry] : []}
    />
  );
}

/** Narrow an unknown tool output to the ToolResult shape. */
export function isToolError(value: unknown): value is ToolError {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { success?: unknown }).success === false
  );
}

export function isToolSuccess<T>(value: unknown): value is { success: true; data: T } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { success?: unknown }).success === true &&
    !!(value as { data?: unknown }).data &&
    typeof (value as { data?: unknown }).data === "object"
  );
}
