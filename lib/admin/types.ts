/**
 * Admin agent tool contract.
 *
 * Pure types (no runtime code, no server imports) so the server steps
 * (lib/workflows/steps/admin-steps.ts) and the admin chat UI
 * (components/chat/admin/*) share the same shapes.
 *
 * Every tool returns `ToolResult<T>` from lib/shop/types.ts: either
 * `{ success: true, data }` or a fixed-message `ToolError`. Money fields come
 * in two forms: raw cents (what the sandbox file holds, for arithmetic) and a
 * `...Display` string already formatted for people.
 *
 * Big results are not retyped by the model. Each back-office tool writes ALL
 * rows to a JSON file in the admin sandbox and returns a short preview plus the
 * file path, so `bash` can compute over the full data.
 */
import type {
  GetAllCategoriesData,
  SearchProductsData,
  SearchProductsInput,
  ToolResult,
} from "@/lib/shop/types";

export interface DateWindow {
  /** ISO 8601 start of the window the store applied. */
  from: string;
  to: string;
}

/** Fields shared by every dataset result. */
export interface DatasetInfo {
  /**
   * Sandbox path of a JSON file holding ALL fetched rows (an array), or null
   * when saving to the sandbox failed (then `bash` cannot use this data).
   */
  file: string | null;
  /** Rows fetched from the store. */
  total: number;
  /** Rows in `rows` (a preview, never more than `total`). */
  shown: number;
  /** True when `rows` is only the first part of `total`. */
  truncated: boolean;
  /** True when the store returned as many rows as `limit` allowed: more may exist. */
  maybeCapped: boolean;
  /** The row limit that was applied, or null when the endpoint has no limit. */
  limit: number | null;
}

export interface TicketRow {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  assignee: string | null;
  relatedOrderId: string | null;
  relatedReturnId: string | null;
  createdAt: string;
  /** Customer-written text: untrusted data. Shortened. */
  messagePreview: string;
}

export interface TicketsData extends DatasetInfo {
  rows: TicketRow[];
  window: DateWindow;
}

export interface ReturnRow {
  id: string;
  orderId: string;
  /** pending | processing | completed */
  status: string;
  /** approved | rejected | needs_info, or null until decided */
  decision: string | null;
  /** Customer-written text: untrusted data. Shortened. */
  reason: string;
  items: { productId: string; quantity: number }[];
  /** Cents, or null when nothing was refunded (yet). */
  refundAmount: number | null;
  refundDisplay: string | null;
  orderStatus: string | null;
  orderTotalDisplay: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface ReturnsData extends DatasetInfo {
  rows: ReturnRow[];
  window: DateWindow;
}

export interface StockRow {
  productId: string;
  name: string;
  category: string;
  stock: number;
  inStock: boolean;
  /** The store's flag: 1 to 5 units. Zero stock is `inStock: false`, not lowStock. */
  lowStock: boolean;
  updatedAt: string;
}

export interface StockData extends DatasetInfo {
  rows: StockRow[];
  page: number;
  totalPages: number;
  /** Products matching the filters across all pages. */
  totalMatching: number;
  hasNextPage: boolean;
}

export interface SalesRow {
  productId: string;
  name: string;
  category: string;
  unitsSold: number;
  ordersCount: number;
  /** Cents. */
  revenue: number;
  revenueDisplay: string;
}

export interface SalesData extends DatasetInfo {
  rows: SalesRow[];
  window: DateWindow;
  days: number;
  currency: string;
  totals: {
    unitsSold: number;
    ordersCount: number;
    /** Cents. */
    revenue: number;
    revenueDisplay: string;
  };
}

export interface BashData {
  stdout: string;
  stderr: string;
  /** 0 means success. Non-zero is a normal result the model must read, not a thrown error. */
  exitCode: number;
  /** True when stdout or stderr was cut to keep the chat small. */
  truncated: boolean;
}

export interface SaveMemoryData {
  /** "saved", or "duplicate" when the note was already in memory. */
  status: "saved" | "duplicate";
  note: string;
}

export interface GetSupportTicketsInput {
  from?: string;
  to?: string;
  status?: string;
  priority?: string;
  category?: string;
  assignee?: string;
  limit?: number;
}

export interface GetReturnsHistoryInput {
  from?: string;
  to?: string;
  status?: string;
  decision?: string;
  limit?: number;
}

export interface GetInventoryStockInput {
  productIds?: string[];
  lowStock?: boolean;
  inStock?: boolean;
  page?: number;
  limit?: number;
}

export interface GetSalesAnalyticsInput {
  from?: string;
  to?: string;
  productId?: string;
}

export interface BashInput {
  command: string;
}

export interface SaveMemoryInput {
  note: string;
  kind: "preference" | "correction" | "business_context";
}

/** UI tool map used to type `UIMessage` on the client without importing server code. */
export type AdminUITools = {
  getSupportTickets: { input: GetSupportTicketsInput; output: ToolResult<TicketsData> };
  getReturnsHistory: { input: GetReturnsHistoryInput; output: ToolResult<ReturnsData> };
  getInventoryStock: { input: GetInventoryStockInput; output: ToolResult<StockData> };
  getSalesAnalytics: { input: GetSalesAnalyticsInput; output: ToolResult<SalesData> };
  searchProducts: { input: SearchProductsInput; output: ToolResult<SearchProductsData> };
  getAllCategories: { input: Record<string, never>; output: ToolResult<GetAllCategoriesData> };
  bash: { input: BashInput; output: ToolResult<BashData> };
  saveMemory: { input: SaveMemoryInput; output: ToolResult<SaveMemoryData> };
};

/** What the workflow loads before the agent runs (see loadAdminContextStep). */
export type MemoryState =
  | { status: "ok"; text: string }
  | { status: "empty" }
  | { status: "unavailable" };

export interface AdminContext {
  /** Today's date, UTC, YYYY-MM-DD. */
  today: string;
  memory: MemoryState;
}
