"use client";

import { Badge } from "@/components/ui/badge";
import { MessageResponse } from "@/components/ai-elements/message";
import type { AdminMessage } from "@/components/chat/admin/types";
import {
  type Column,
  DataTable,
  ToolCard,
  day,
  failedSummary,
  isErroredState,
  isPendingState,
} from "@/components/chat/admin/tool-card";
import { BashView } from "@/components/chat/admin/bash-view";
import { isToolError, isToolSuccess } from "@/components/chat/shop/tool-status";
import type {
  BashData,
  ReturnRow,
  ReturnsData,
  SalesData,
  SalesRow,
  SaveMemoryData,
  StockData,
  StockRow,
  TicketRow,
  TicketsData,
} from "@/lib/admin/types";
import type { GetAllCategoriesData, SearchProductsData } from "@/lib/shop/types";

type Part = AdminMessage["parts"][number];

/** Renders one message's parts in order. Unknown part types are ignored. */
export function AdminMessageParts({
  message,
  isStreaming,
}: {
  message: AdminMessage;
  /** True for the assistant message that is currently streaming. */
  isStreaming: boolean;
}) {
  return (
    <>
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`;
        if (part.type === "text") {
          if (!part.text) return null;
          if (message.role === "user") {
            return (
              <p key={key} className="whitespace-pre-wrap break-words">
                {part.text}
              </p>
            );
          }
          return (
            <MessageResponse
              key={key}
              className="max-w-prose leading-relaxed"
              isAnimating={isStreaming && part.state === "streaming"}
            >
              {part.text}
            </MessageResponse>
          );
        }
        return <ToolPart key={key} part={part} />;
      })}
    </>
  );
}

function ToolPart({ part }: { part: Part }) {
  switch (part.type) {
    case "tool-getSupportTickets":
      return <TicketsCard part={part} />;
    case "tool-getReturnsHistory":
      return <ReturnsCard part={part} />;
    case "tool-getInventoryStock":
      return <StockCard part={part} />;
    case "tool-getSalesAnalytics":
      return <SalesCard part={part} />;
    case "tool-searchProducts":
      return <SearchCard part={part} />;
    case "tool-getAllCategories":
      return <CategoriesCard part={part} />;
    case "tool-bash":
      return <BashCard part={part} />;
    case "tool-saveMemory":
      return <MemoryCard part={part} />;
    // reasoning, step-start, sources, data parts, dynamic tools: not shown.
    default:
      return null;
  }
}

type ToolOf<N extends string> = Extract<Part, { type: `tool-${N}` }>;

/** The three states every tool card has, before its own success view. */
function stateCard<P extends { state: string; input?: unknown; output?: unknown }>(
  part: P,
  title: string,
  runningText: string,
  failText: string,
): { done: React.ReactNode | null; output: unknown } {
  if (isPendingState(part.state)) {
    return { done: <ToolCard title={title} status="running" summary={runningText} input={part.input} />, output: null };
  }
  if (isErroredState(part.state)) {
    // errorText can hold internal details, so it is never shown.
    return { done: <ToolCard title={title} status="failed" summary={failText} input={part.input} />, output: null };
  }
  const output: unknown = part.output;
  if (isToolError(output)) {
    return {
      done: <ToolCard title={title} status="failed" summary={failedSummary(output.error)} input={part.input} />,
      output: null,
    };
  }
  return { done: null, output };
}

function rowsLabel(n: number) {
  if (n === 0) return undefined; // the empty message stays visible
  return `Show ${n} row${n === 1 ? "" : "s"}`;
}

/** "Showing 20 of 87 rows. Capped at 200: more may exist." */
function datasetNote(d: { total: number; shown: number; truncated: boolean; maybeCapped: boolean; limit: number | null }) {
  const parts = [`${d.total} row${d.total === 1 ? "" : "s"} fetched`];
  if (d.truncated) parts.push(`showing the first ${d.shown}`);
  if (d.maybeCapped && d.limit !== null) parts.push(`limit ${d.limit} reached, more may exist`);
  return parts.join(", ");
}

function windowText(w: { from: string; to: string }) {
  return `${day(w.from)} to ${day(w.to)} (UTC)`;
}

const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  urgent: "destructive",
  high: "destructive",
  rejected: "destructive",
  open: "default",
  approved: "secondary",
  resolved: "secondary",
};

function Tag({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">-</span>;
  return (
    <Badge variant={STATUS_TONE[value] ?? "outline"} className="whitespace-nowrap font-normal">
      {value.replace(/_/g, " ")}
    </Badge>
  );
}

function TicketsCard({ part }: { part: ToolOf<"getSupportTickets"> }) {
  const title = "Support tickets";
  const early = stateCard(part, title, "Loading support tickets...", "Couldn't load support tickets.");
  if (early.done) return early.done;
  const output = early.output;
  if (!isToolSuccess<TicketsData>(output) || !Array.isArray(output.data.rows)) {
    return <ToolCard title={title} status="failed" summary="Couldn't read the ticket data." input={part.input} />;
  }
  const d = output.data;
  const columns: Column<TicketRow>[] = [
    { header: "Ticket", cell: (r) => <span className="font-medium">{r.id}</span> },
    { header: "Subject", cell: (r) => <span className="break-words">{r.subject}</span> },
    { header: "Status", cell: (r) => <Tag value={r.status} /> },
    { header: "Priority", cell: (r) => <Tag value={r.priority} /> },
    { header: "Category", cell: (r) => r.category.replace(/_/g, " ") },
    { header: "Assignee", cell: (r) => r.assignee ?? "unassigned" },
    { header: "Created", cell: (r) => day(r.createdAt) },
  ];
  return (
    <ToolCard title={title} status="done" summary={`${windowText(d.window)}. ${datasetNote(d)}.`} input={part.input} collapsedLabel={rowsLabel(d.shown)}>
      <DataTable caption="Support tickets" columns={columns} rows={d.rows} emptyText="No tickets in that window." />
    </ToolCard>
  );
}

function ReturnsCard({ part }: { part: ToolOf<"getReturnsHistory"> }) {
  const title = "Returns history";
  const early = stateCard(part, title, "Loading returns...", "Couldn't load returns history.");
  if (early.done) return early.done;
  const output = early.output;
  if (!isToolSuccess<ReturnsData>(output) || !Array.isArray(output.data.rows)) {
    return <ToolCard title={title} status="failed" summary="Couldn't read the returns data." input={part.input} />;
  }
  const d = output.data;
  const columns: Column<ReturnRow>[] = [
    { header: "Return", cell: (r) => <span className="font-medium">{r.id}</span> },
    { header: "Order", cell: (r) => r.orderId },
    { header: "Status", cell: (r) => <Tag value={r.status} /> },
    { header: "Decision", cell: (r) => <Tag value={r.decision} /> },
    { header: "Refund", cell: (r) => r.refundDisplay ?? "-", align: "right" },
    { header: "Created", cell: (r) => day(r.createdAt) },
  ];
  return (
    <ToolCard title={title} status="done" summary={`${windowText(d.window)}. ${datasetNote(d)}.`} input={part.input} collapsedLabel={rowsLabel(d.shown)}>
      <DataTable caption="Returns history" columns={columns} rows={d.rows} emptyText="No returns in that window." />
    </ToolCard>
  );
}

function StockCard({ part }: { part: ToolOf<"getInventoryStock"> }) {
  const title = "Inventory";
  const early = stateCard(part, title, "Loading stock levels...", "Couldn't load inventory.");
  if (early.done) return early.done;
  const output = early.output;
  if (!isToolSuccess<StockData>(output) || !Array.isArray(output.data.rows)) {
    return <ToolCard title={title} status="failed" summary="Couldn't read the inventory data." input={part.input} />;
  }
  const d = output.data;
  const columns: Column<StockRow>[] = [
    { header: "Product", cell: (r) => <span className="break-words font-medium">{r.name}</span> },
    { header: "Category", cell: (r) => r.category },
    { header: "Stock", cell: (r) => r.stock, align: "right" },
    {
      header: "Level",
      cell: (r) => <Tag value={!r.inStock ? "out of stock" : r.lowStock ? "low stock" : "ok"} />,
    },
  ];
  const paging = `Page ${d.page} of ${d.totalPages}, ${d.totalMatching} matching product${d.totalMatching === 1 ? "" : "s"}${d.hasNextPage ? ", more pages available" : ""}.`;
  return (
    <ToolCard title={title} status="done" summary={`${paging} ${d.truncated ? `Showing the first ${d.shown}.` : ""}`.trim()} input={part.input} collapsedLabel={rowsLabel(d.shown)}>
      <DataTable caption="Inventory stock" columns={columns} rows={d.rows} emptyText="No products match those filters." />
    </ToolCard>
  );
}

function SalesCard({ part }: { part: ToolOf<"getSalesAnalytics"> }) {
  const title = "Sales";
  const early = stateCard(part, title, "Loading sales...", "Couldn't load sales.");
  if (early.done) return early.done;
  const output = early.output;
  if (!isToolSuccess<SalesData>(output) || !Array.isArray(output.data.rows)) {
    return <ToolCard title={title} status="failed" summary="Couldn't read the sales data." input={part.input} />;
  }
  const d = output.data;
  const columns: Column<SalesRow>[] = [
    { header: "Product", cell: (r) => <span className="break-words font-medium">{r.name}</span> },
    { header: "Units", cell: (r) => r.unitsSold, align: "right" },
    { header: "Orders", cell: (r) => r.ordersCount, align: "right" },
    { header: "Revenue", cell: (r) => r.revenueDisplay, align: "right" },
  ];
  const totals = `${d.totals.unitsSold} units, ${d.totals.ordersCount} orders, ${d.totals.revenueDisplay} over ${d.days} day${d.days === 1 ? "" : "s"}`;
  return (
    <ToolCard title={title} status="done" summary={`${windowText(d.window)}. ${totals}.`} input={part.input} collapsedLabel={rowsLabel(d.shown)}>
      <DataTable caption="Sales by product" columns={columns} rows={d.rows} emptyText="No sales in that window." />
      {d.truncated ? (
        <p className="px-3 pb-2 text-xs text-muted-foreground">Showing the first {d.shown} of {d.total} products.</p>
      ) : null}
    </ToolCard>
  );
}

function SearchCard({ part }: { part: ToolOf<"searchProducts"> }) {
  const title = "Product search";
  const query = part.input?.query?.trim();
  const category = part.input?.category?.trim();
  const what = query ? ` for "${query}"` : category ? ` in ${category}` : "";
  const early = stateCard(part, title, `Searching products${what}...`, "Couldn't search the catalog.");
  if (early.done) return early.done;
  const output = early.output;
  if (!isToolSuccess<SearchProductsData>(output) || !Array.isArray(output.data.products)) {
    return <ToolCard title={title} status="failed" summary="Couldn't read the search results." input={part.input} />;
  }
  const d = output.data;
  const columns: Column<SearchProductsData["products"][number]>[] = [
    { header: "Product", cell: (r) => <span className="break-words font-medium">{r.name}</span> },
    { header: "Id", cell: (r) => <code>{r.id}</code> },
    { header: "Category", cell: (r) => r.category },
    { header: "Price", cell: (r) => r.priceDisplay, align: "right" },
  ];
  return (
    <ToolCard
      title={title}
      status="done"
      summary={`${d.total} product${d.total === 1 ? "" : "s"} found${what}.`}
      input={part.input}
      collapsedLabel={rowsLabel(d.products.length)}
    >
      <DataTable caption="Matching products" columns={columns} rows={d.products} emptyText="No products matched." />
    </ToolCard>
  );
}

function CategoriesCard({ part }: { part: ToolOf<"getAllCategories"> }) {
  const title = "Categories";
  const early = stateCard(part, title, "Loading categories...", "Couldn't load categories.");
  if (early.done) return early.done;
  const output = early.output;
  if (!isToolSuccess<GetAllCategoriesData>(output) || !Array.isArray(output.data.categories)) {
    return <ToolCard title={title} status="failed" summary="Couldn't read the categories." input={part.input} />;
  }
  const list = output.data.categories;
  return (
    <ToolCard title={title} status="done" summary={`${list.length} categor${list.length === 1 ? "y" : "ies"}.`}>
      {list.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 px-3 py-2">
          {list.map((c) => (
            <li key={c.slug}>
              <Badge variant="outline" className="font-normal">
                {c.name} ({c.productCount})
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </ToolCard>
  );
}

function BashCard({ part }: { part: ToolOf<"bash"> }) {
  const command = part.input?.command ?? "";
  if (isPendingState(part.state)) {
    return <BashView command={command} state="running" />;
  }
  if (isErroredState(part.state)) {
    return <BashView command={command} state="failed" note="The command could not be run." />;
  }
  const output: unknown = part.output;
  if (isToolError(output)) {
    return <BashView command={command} state="failed" note={failedSummary(output.error)} />;
  }
  if (isToolSuccess<BashData>(output)) {
    const d = output.data;
    return (
      <BashView
        command={command}
        state={d.exitCode === 0 ? "done" : "failed"}
        stdout={d.stdout}
        stderr={d.stderr}
        exitCode={d.exitCode}
        truncated={d.truncated}
      />
    );
  }
  return <BashView command={command} state="failed" note="The command result could not be read." />;
}

function MemoryCard({ part }: { part: ToolOf<"saveMemory"> }) {
  const title = "Memory";
  const early = stateCard(part, title, "Saving a note...", "Couldn't save that note.");
  if (early.done) return early.done;
  const output = early.output;
  if (!isToolSuccess<SaveMemoryData>(output)) {
    return <ToolCard title={title} status="failed" summary="Couldn't confirm the note was saved." />;
  }
  const d = output.data;
  return (
    <ToolCard
      title={d.status === "duplicate" ? "Already in memory" : "Saved to memory"}
      status="done"
      summary={d.note}
    />
  );
}
