/**
 * Shopping agent tool contract.
 *
 * Pure types (no runtime code, no server imports) so both the server tools
 * (lib/shop/tools.ts, lib/workflows/*) and the client generative UI
 * (components/chat/shop/*) import the same shapes. Change a shape here and
 * both sides must follow.
 *
 * Every tool returns `ToolResult<T>`: either `{ success: true, data }` or a
 * `ToolError` produced by `toToolError()` in lib/tool-errors.ts. Tools never
 * throw for expected failures (not found, invalid input, empty results), so
 * the model can explain them; only transient failures throw (to let the
 * workflow step retry) and are converted to a ToolError after retries.
 */

export type ToolErrorCode =
  | "not_found"
  | "invalid_request"
  | "not_eligible"
  | "rate_limited"
  | "unavailable"
  | "unknown";

export interface ToolError {
  success: false;
  error: {
    code: ToolErrorCode;
    /** Fixed, user-safe sentence. Never derived from a raw error or URL. */
    message: string;
    /** True when trying the same call again later could succeed. */
    retryable: boolean;
  };
}

export type ToolResult<T> = { success: true; data: T } | ToolError;

/** Prices are integer cents. Format with formatPrice(cents, currency). */
export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
  /** `price` already formatted (e.g. "$60.00"), so the model never converts cents. */
  priceDisplay: string;
  category: string;
  /** First product image, or null when the product has none. */
  image: string | null;
  featured: boolean;
  /** Link to the existing product page, e.g. "/products/black-pullover-hoodie". */
  href: string;
}

export interface SearchProductsData {
  products: ProductSummary[];
  /** Echo of the applied filters, so the UI can describe the result set. */
  query: string | null;
  category: string | null;
  page: number;
  totalPages: number;
  total: number;
  hasNextPage: boolean;
}

export interface CategorySummary {
  slug: string;
  name: string;
  productCount: number;
}

export interface GetAllCategoriesData {
  categories: CategorySummary[];
}

export interface ProductStockSummary {
  stock: number;
  inStock: boolean;
  lowStock: boolean;
}

export interface ProductDetailsData {
  product: {
    id: string;
    name: string;
    slug: string;
    description: string;
    price: number;
    currency: string;
    /** `price` already formatted (e.g. "$60.00"). */
    priceDisplay: string;
    category: string;
    images: string[];
    tags: string[];
    featured: boolean;
    href: string;
  };
  /** null when live stock could not be loaded; the product data is still valid. */
  stock: ProductStockSummary | null;
}

export interface ReturnOrderItem {
  productId: string;
  quantity: number;
}

/**
 * Returned by the returnOrder tool as soon as the background return workflow
 * has started. The workflow itself (lookup -> notify -> pre-authorize ->
 * file -> await decision) keeps running after the chat answers.
 */
export interface ReturnOrderData {
  status: "filed";
  orderId: string;
  /**
   * True when a return for this order was already filed earlier, so no new
   * return was created; `returnRunId` then points at the existing one.
   */
  duplicate?: boolean;
  /** Workflow run id of the background return; used to poll its progress. */
  returnRunId: string;
  items: ReturnOrderItem[];
  /** Order total in cents, for the confirmation card. */
  orderTotal: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Tool inputs (mirror the zod schemas in lib/shop/tools.ts) and the UI tool
// map used to type `UIMessage` on the client without importing server code.
// ---------------------------------------------------------------------------

export interface SearchProductsInput {
  query?: string;
  category?: string;
  page?: number;
  limit?: number;
}

export interface GetProductDetailsInput {
  /** Product id ("hoodie_001") or slug ("black-pullover-hoodie"). */
  productId: string;
}

export interface ReturnOrderInput {
  orderId: string;
  reason: string;
  /** Omit to return every item on the order. */
  items?: ReturnOrderItem[];
}

export type ShopUITools = {
  searchProducts: {
    input: SearchProductsInput;
    output: ToolResult<SearchProductsData>;
  };
  getAllCategories: {
    input: Record<string, never>;
    output: ToolResult<GetAllCategoriesData>;
  };
  getProductDetails: {
    input: GetProductDetailsInput;
    output: ToolResult<ProductDetailsData>;
  };
  returnOrder: {
    input: ReturnOrderInput;
    output: ToolResult<ReturnOrderData>;
  };
};

/** Input to the background return workflow (lib/workflows/return-flow.ts). */
export interface ReturnWorkflowInput {
  orderId: string;
  reason: string;
  /** Already validated against the order by the returnOrder tool. */
  items: ReturnOrderItem[];
}

/** Progress of the background return, served by GET /api/returns/[runId]. */
export type ReturnProgressStage =
  | "running"
  | "awaiting_decision"
  | "completed"
  | "failed";

export interface ReturnProgress {
  stage: ReturnProgressStage;
  returnId: string | null;
  decision: "approved" | "rejected" | "needs_info" | null;
  /** Cents. */
  refundAmount: number | null;
  currency: string | null;
  notes: string | null;
}
