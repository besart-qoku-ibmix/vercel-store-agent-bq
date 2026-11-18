/**
 * Admin tool implementations. Each exported function is a durable step (see
 * lib/admin-tools.ts, which hands them to the admin agent), so a transient
 * store or sandbox failure retries just that call, not the conversation.
 *
 * Contract (same as lib/workflows/steps/shop-steps.ts):
 * - Expected outcomes (bad dates, not found, refused memory note) are RETURNED
 *   as a ToolError so the model can explain them.
 * - Transient failures are THROWN so the step retries, and on the last attempt
 *   returned as a ToolError, so a run ends with an honest message.
 * - Nothing returned contains raw error text, URLs or `details`.
 * - Store data access is read-only: only GET helpers from lib/api.ts are used.
 *
 * Data flow: each back-office tool writes ALL rows to a JSON file in the admin
 * sandbox and returns a short preview plus the file path. `bash` then computes
 * over the files, so the model never retypes data or does arithmetic.
 *
 * No `server-only` import: steps are bundled outside Next.js.
 */
import { createHash } from "node:crypto";
import { getStepMetadata } from "workflow";
import {
  getBackOfficeReturns,
  getBackOfficeSales,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
  getStoreConfig,
} from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { cleanNote, looksSecret, memoryForPrompt } from "@/lib/admin/memory";
import { appendMemoryNote, readMemoryFile, runBash, writeDataFile } from "@/lib/admin/sandbox";
import type {
  GetInventoryStockToolInput,
  GetReturnsHistoryToolInput,
  GetSalesAnalyticsToolInput,
  GetSupportTicketsToolInput,
  BashToolInput,
  SaveMemoryToolInput,
} from "@/lib/admin/schemas";
import type {
  AdminContext,
  BashData,
  DatasetInfo,
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
import type { ToolResult } from "@/lib/shop/types";
import { isTransientError, toToolError, toolError, toolOk } from "@/lib/tool-errors";

const PREVIEW_ROWS = 20;
const PREVIEW_SALES_ROWS = 30;
const PREVIEW_TEXT = 140;

function money(cents: number, currency: string): string {
  try {
    return formatPrice(cents, currency);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function clip(text: string | null | undefined, max = PREVIEW_TEXT): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Throw transient errors until the last attempt; otherwise map to a ToolError. */
function handleFailure(err: unknown, subject?: string): ToolResult<never> {
  const { attempt, maxAttempts } = getStepMetadata();
  if (isTransientError(err) && attempt < maxAttempts) {
    // A fixed message: the original error text can contain the API URL.
    throw new Error("Store service temporarily unavailable");
  }
  return toToolError(err, subject);
}

/** A stable short name so different filters never overwrite each other's file. */
function fileKey(dataset: string, input: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(input ?? {})).digest("hex").slice(0, 8);
  return `${dataset}-${hash}`;
}

function badWindow(from?: string, to?: string): ToolResult<never> | null {
  if (from && to && Date.parse(from) > Date.parse(to)) {
    return toolError("invalid_request", "The start date is after the end date, so nothing was fetched.");
  }
  return null;
}

/**
 * Saves every row for `bash` and builds the dataset fields. A sandbox failure
 * is not fatal: the rows are still returned, with `file: null`.
 */
async function saveDataset<Row>(
  dataset: string,
  input: unknown,
  rows: Row[],
  preview: Row[],
  limit: number | null,
): Promise<DatasetInfo & { rows: Row[] }> {
  const file = await writeDataFile(fileKey(dataset, input), rows).catch(() => null);
  return {
    file,
    total: rows.length,
    shown: preview.length,
    truncated: preview.length < rows.length,
    maybeCapped: limit !== null && rows.length >= limit,
    limit,
    rows: preview,
  };
}

// ---------------------------------------------------------------------------
// Back-office reads
// ---------------------------------------------------------------------------

export async function getSupportTicketsStep(
  input: GetSupportTicketsToolInput,
): Promise<ToolResult<TicketsData>> {
  "use step";
  const invalid = badWindow(input.from, input.to);
  if (invalid) return invalid;
  const limit = input.limit ?? 100;
  try {
    const { data, meta } = await getBackOfficeSupportTickets({
      from: input.from,
      to: input.to,
      status: input.status,
      priority: input.priority,
      category: input.category,
      assignee: input.assignee,
      limit,
    });
    const all: TicketRow[] = data.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      category: t.category,
      assignee: t.assignee,
      relatedOrderId: t.relatedOrderId,
      relatedReturnId: t.relatedReturnId,
      createdAt: t.createdAt,
      messagePreview: t.messagePreview,
    }));
    const preview = all.slice(0, PREVIEW_ROWS).map((r) => ({
      ...r,
      subject: clip(r.subject),
      messagePreview: clip(r.messagePreview),
    }));
    const set = await saveDataset("tickets", input, all, preview, limit);
    return toolOk({ ...set, window: { from: meta.from, to: meta.to } });
  } catch (err) {
    return handleFailure(err);
  }
}

export async function getReturnsHistoryStep(
  input: GetReturnsHistoryToolInput,
): Promise<ToolResult<ReturnsData>> {
  "use step";
  const invalid = badWindow(input.from, input.to);
  if (invalid) return invalid;
  const limit = input.limit ?? 200;
  try {
    const { data, meta } = await getBackOfficeReturns({
      from: input.from,
      to: input.to,
      status: input.status,
      decision: input.decision,
      limit,
    });
    // Return rows carry cents but no currency: use the store's own.
    const currency = await getStoreConfig()
      .then((c) => c.currency || "USD")
      .catch(() => "USD");
    const all: ReturnRow[] = data.map((r) => {
      return {
        id: r.id,
        orderId: r.orderId,
        status: r.status,
        decision: r.decision,
        reason: r.reason,
        items: r.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        refundAmount: r.refundAmount,
        refundDisplay: r.refundAmount === null ? null : money(r.refundAmount, currency),
        orderStatus: r.order?.status ?? null,
        orderTotalDisplay: r.order ? money(r.order.total, currency) : null,
        createdAt: r.createdAt,
        processedAt: r.processedAt,
      };
    });
    const preview = all.slice(0, PREVIEW_ROWS).map((r) => ({ ...r, reason: clip(r.reason) }));
    const set = await saveDataset("returns", input, all, preview, limit);
    return toolOk({ ...set, window: { from: meta.from, to: meta.to } });
  } catch (err) {
    return handleFailure(err);
  }
}

export async function getInventoryStockStep(
  input: GetInventoryStockToolInput,
): Promise<ToolResult<StockData>> {
  "use step";
  const limit = input.limit ?? 100;
  const page = input.page ?? 1;
  try {
    const { data, meta } = await getBackOfficeStock({
      productIds: input.productIds,
      lowStock: input.lowStock,
      inStock: input.inStock,
      page,
      limit,
    });
    const all: StockRow[] = data.map((s) => ({
      productId: s.productId,
      name: s.product.name,
      category: s.product.category,
      stock: s.stock,
      inStock: s.inStock,
      lowStock: s.lowStock,
      updatedAt: s.updatedAt,
    }));
    const preview = all.slice(0, PREVIEW_ROWS);
    // A page is never "capped" in the sense of hidden rows: paging is explicit.
    const set = await saveDataset("stock", input, all, preview, null);
    const p = meta.pagination;
    return toolOk({
      ...set,
      limit,
      page: p?.page ?? page,
      totalPages: p?.totalPages ?? 1,
      totalMatching: p?.total ?? all.length,
      hasNextPage: p?.hasNextPage ?? false,
    });
  } catch (err) {
    return handleFailure(err);
  }
}

export async function getSalesAnalyticsStep(
  input: GetSalesAnalyticsToolInput,
): Promise<ToolResult<SalesData>> {
  "use step";
  const invalid = badWindow(input.from, input.to);
  if (invalid) return invalid;
  try {
    const { data, meta } = await getBackOfficeSales({
      from: input.from,
      to: input.to,
      productId: input.productId,
    });
    const currency = meta.currency || "USD";
    const all: SalesRow[] = data.map((s) => ({
      productId: s.productId,
      name: s.product.name,
      category: s.product.category,
      unitsSold: s.unitsSold,
      ordersCount: s.ordersCount,
      revenue: s.revenue,
      revenueDisplay: money(s.revenue, currency),
    }));
    const set = await saveDataset("sales", input, all, all.slice(0, PREVIEW_SALES_ROWS), null);
    return toolOk({
      ...set,
      window: { from: meta.from, to: meta.to },
      days: meta.days,
      currency,
      totals: {
        unitsSold: meta.totals.unitsSold,
        ordersCount: meta.totals.ordersCount,
        revenue: meta.totals.revenue,
        revenueDisplay: money(meta.totals.revenue, currency),
      },
    });
  } catch (err) {
    return handleFailure(err, "product");
  }
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

/**
 * Runs a command in the admin sandbox. Fewer retries than the read steps: a
 * command can write files, so it should not be replayed many times. A command
 * that exits non-zero is a normal result (success: true, exitCode != 0); only
 * failing to reach the sandbox is an error.
 */
export async function bashStep(input: BashToolInput): Promise<ToolResult<BashData>> {
  "use step";
  try {
    return toolOk(await runBash(input.command));
  } catch {
    const { attempt, maxAttempts } = getStepMetadata();
    if (attempt < maxAttempts) throw new Error("Sandbox temporarily unavailable");
    return toolError(
      "unavailable",
      "The calculation sandbox isn't responding right now. Please try again in a moment.",
      true,
    );
  }
}
bashStep.maxRetries = 1;

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/**
 * Appends one note to the memory file in the admin sandbox. Safe to retry: a
 * note that is already saved comes back as "duplicate" and is not added twice.
 * Credential-looking text is refused, so memory can never hand a secret back.
 */
export async function saveMemoryStep(
  input: SaveMemoryToolInput,
): Promise<ToolResult<SaveMemoryData>> {
  "use step";
  const note = cleanNote(input.note);
  if (note.length < 5) {
    return toolError("invalid_request", "That note is empty, so nothing was saved.");
  }
  if (looksSecret(note)) {
    return toolError(
      "invalid_request",
      "I can't save passwords, keys or other secrets to memory, so nothing was saved.",
    );
  }
  try {
    const date = new Date().toISOString().slice(0, 10);
    const outcome = await appendMemoryNote(input.kind, note, date);
    if (outcome === "full") {
      return toolError(
        "unavailable",
        "Memory is full, so that note was not saved. Ask an administrator to clean it up.",
      );
    }
    return toolOk({ status: outcome, note });
  } catch {
    const { attempt, maxAttempts } = getStepMetadata();
    if (attempt < maxAttempts) throw new Error("Sandbox temporarily unavailable");
    return toolError(
      "unavailable",
      "I couldn't reach memory right now, so that note was not saved.",
      true,
    );
  }
}

/**
 * Runs at the start of every admin turn. Application code (not the model)
 * reads the memory file and hands its notes to the agent. A missing file is
 * normal on a first conversation; an unreachable sandbox is reported so the
 * agent can say memory was unavailable instead of pretending it is empty.
 */
export async function loadAdminContextStep(): Promise<AdminContext> {
  "use step";
  const today = new Date().toISOString().slice(0, 10);
  try {
    const text = memoryForPrompt(await readMemoryFile());
    return { today, memory: text ? { status: "ok", text } : { status: "empty" } };
  } catch {
    return { today, memory: { status: "unavailable" } };
  }
}
