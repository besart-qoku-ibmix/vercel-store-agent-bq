"use client";

import Ansi from "ansi-to-react";
import { CircleAlert, CircleCheck, LoaderCircle, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Command activity in the admin conversation: the command, a running state
 * while it executes, and its output, stderr and exit code when it is done.
 * A non-zero exit code is shown as a failure, not hidden.
 */
export function BashView({
  command,
  state,
  stdout,
  stderr,
  exitCode,
  truncated,
  note,
}: {
  command: string;
  state: "running" | "done" | "failed";
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  truncated?: boolean;
  /** Fixed, user-safe text for a command that could not run at all. */
  note?: string;
}) {
  const hasOutput = Boolean(stdout?.trim() || stderr?.trim());
  return (
    <section
      aria-label="Calculation"
      aria-busy={state === "running"}
      className="w-full min-w-0 overflow-hidden rounded-lg border border-border bg-card text-sm"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span aria-hidden="true" className="shrink-0">
          {state === "running" ? (
            <LoaderCircle className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
          ) : state === "failed" ? (
            <CircleAlert className="size-4 text-destructive" />
          ) : (
            <CircleCheck className="size-4 text-muted-foreground" />
          )}
        </span>
        <Terminal aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 font-medium text-foreground">
          {state === "running"
            ? "Calculating in the sandbox..."
            : state === "failed"
              ? typeof exitCode === "number"
                ? `Command failed (exit code ${exitCode})`
                : "Command didn't run"
              : "Calculation finished"}
        </p>
      </header>

      <div className="space-y-2 p-3">
        {/* The script can be long, so it is folded away. It opens by itself
            when the command failed, because then it is what you want to read. */}
        <details open={state === "failed"} className="text-xs">
          <summary className="cursor-pointer select-none rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            Show command
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono leading-relaxed">
            <code>
              <span aria-hidden="true" className="text-muted-foreground">$ </span>
              {command || "..."}
            </code>
          </pre>
        </details>

        {note ? <p className="text-xs text-destructive">{note}</p> : null}

        {hasOutput ? (
          <pre
            className={cn(
              "max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-xs leading-relaxed",
            )}
          >
            <span className="mb-1 block font-sans text-[10px] uppercase tracking-wide text-muted-foreground">
              Output
            </span>
            {stdout?.trim() ? (
              <code className="block">
                <Ansi>{stdout.trimEnd()}</Ansi>
              </code>
            ) : null}
            {stderr?.trim() ? (
              <code className="block text-destructive">
                <Ansi>{stderr.trimEnd()}</Ansi>
              </code>
            ) : null}
          </pre>
        ) : state === "done" ? (
          <p className="text-xs text-muted-foreground">The command printed nothing.</p>
        ) : null}

        {truncated ? (
          <p className="text-xs text-muted-foreground">The output was cut to keep the chat short.</p>
        ) : null}
      </div>
    </section>
  );
}
