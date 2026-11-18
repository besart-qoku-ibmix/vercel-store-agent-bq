"use client";

import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ToolError } from "@/lib/shop/types";

/**
 * Shared presentation for admin tool calls: a titled card with a status line,
 * the result, and a collapsible "Details" with the parameters (admin only: the
 * shopping chat never shows parameters).
 */

export type ToolStatus = "running" | "done" | "failed";

export function isPendingState(state: string): boolean {
  return (
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-requested" ||
    state === "approval-responded"
  );
}

export function isErroredState(state: string): boolean {
  return state === "output-error" || state === "output-denied";
}

export function ToolCard({
  title,
  status,
  summary,
  input,
  collapsedLabel,
  children,
}: {
  title: string;
  status: ToolStatus;
  /** One line under the title: what was fetched, or why it failed. */
  summary?: string;
  /** Raw tool parameters, shown under "Details". */
  input?: unknown;
  /** When set, the result is folded away behind this label until opened. */
  collapsedLabel?: string;
  children?: ReactNode;
}) {
  const hasInput =
    input !== undefined &&
    input !== null &&
    typeof input === "object" &&
    Object.keys(input).length > 0;
  return (
    <section
      aria-label={title}
      aria-busy={status === "running"}
      className="w-full min-w-0 overflow-hidden rounded-lg border border-border bg-card text-sm"
    >
      <header className="flex items-start gap-2 border-b border-border px-3 py-2">
        <span aria-hidden="true" className="mt-0.5 shrink-0">
          {status === "running" ? (
            <LoaderCircle className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
          ) : status === "failed" ? (
            <CircleAlert className="size-4 text-destructive" />
          ) : (
            <CircleCheck className="size-4 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{title}</p>
          {summary ? (
            <p className={cn("text-xs", status === "failed" ? "text-destructive" : "text-muted-foreground")}>
              {summary}
            </p>
          ) : null}
        </div>
        <span className="sr-only">
          {status === "running" ? "Running" : status === "failed" ? "Failed" : "Finished"}
        </span>
      </header>
      {children ? (
        collapsedLabel ? (
          <details className="group border-b border-border last:border-b-0">
            <summary className="cursor-pointer select-none rounded-sm px-3 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              {collapsedLabel}
            </summary>
            <div className="min-w-0">{children}</div>
          </details>
        ) : (
          <div className="min-w-0">{children}</div>
        )
      ) : null}
      {hasInput ? (
        <details className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            Details
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

export interface Column<Row> {
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "right";
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  emptyText,
}: {
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  emptyText: string;
}) {
  if (rows.length === 0) {
    return <p className="px-3 py-3 text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="max-h-80 overflow-auto">
      <Table className="text-xs">
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.header} className={cn("h-8 px-3", c.align === "right" && "text-right")}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell
                  key={c.header}
                  className={cn("px-3 py-1.5 align-top", c.align === "right" && "text-right tabular-nums")}
                >
                  {c.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Short date (UTC) from an ISO string. */
export function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "-";
}

const ERROR_TITLE: Record<ToolError["error"]["code"], string> = {
  not_found: "Not found",
  invalid_request: "That request didn't work",
  not_eligible: "Not allowed",
  rate_limited: "The store is busy",
  unavailable: "Service unavailable",
  unknown: "Something went wrong",
};

/** A tool that returned `{ success: false }`: fixed, user-safe text only. */
export function failedSummary(error: ToolError["error"] | undefined): string {
  if (!error) return "That request failed.";
  const title = ERROR_TITLE[error.code] ?? "Something went wrong";
  const message = typeof error.message === "string" ? error.message : "";
  return `${title}. ${message}${error.retryable ? " This is usually temporary." : ""}`.trim();
}
