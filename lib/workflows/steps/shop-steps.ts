/**
 * Shopping tool implementations. Each exported function is a durable step
 * (see lib/tools.ts, which hands them to the agent), so a transient store API
 * failure retries just that call instead of restarting the conversation.
 *
 * Contract (lib/shop/types.ts):
 * - Expected outcomes (not found, bad input, not eligible, empty results) are
 *   RETURNED as a ToolError, so the model can explain them.
 * - Transient failures (network, 429, 5xx) are THROWN so the step retries.
 *   On the last attempt they are returned as a ToolError instead, so the chat
 *   ends with an honest message rather than a crashed run.
 * - Nothing here returns raw error text, URLs or `details`: only the fixed
 *   messages from lib/tool-errors.ts.
 *
 * No `server-only` import: steps are bundled outside Next.js.
 */
import { getStepMetadata } from "workflow";
import { start } from "workflow/api";
import { HookConflictError } from "workflow/errors";
import {
  getCategories,
  getOrder,
  getProductById,
  getProductStock,
  getProductsWithMeta,
} from "@/lib/api";
import { formatPrice } from "@/lib/format";
import {
  isTransientError,
  toToolError,
  toolError,
  toolOk,
} from "@/lib/tool-errors";
import { returnFlow } from "@/lib/workflows/return-flow";
import type {
  GetAllCategoriesData,
  ProductDetailsData,
  ProductSummary,
  ReturnOrderData,
  ReturnOrderItem,
  SearchProductsData,
  ToolResult,
} from "@/lib/shop/types";
import type {
  GetProductDetailsToolInput,
  ReturnOrderToolInput,
  SearchProductsToolInput,
} from "@/lib/shop/schemas";
import type { Product } from "@/lib/types";

const DEFAULT_LIMIT = 8;

function price(cents: number, currency: string): string {
  try {
    return formatPrice(cents, currency);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
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

function summarize(p: Product): ProductSummary {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    price: p.price,
    currency: p.currency,
    priceDisplay: price(p.price, p.currency),
    category: p.category,
    image: p.images?.[0] ?? null,
    featured: p.featured,
    href: `/products/${encodeURIComponent(p.slug)}`,
  };
}

export async function searchProductsStep(
  input: SearchProductsToolInput,
): Promise<ToolResult<SearchProductsData>> {
  "use step";
  const query = input.query?.trim() || null;
  const category = input.category?.trim() || null;
  try {
    const { data, meta } = await getProductsWithMeta({
      search: query ?? undefined,
      category: category ?? undefined,
      page: input.page ?? 1,
      limit: input.limit ?? DEFAULT_LIMIT,
    });
    const pagination = meta?.pagination;
    return toolOk({
      products: data.map(summarize),
      query,
      category,
      page: pagination?.page ?? input.page ?? 1,
      totalPages: pagination?.totalPages ?? 1,
      total: pagination?.total ?? data.length,
      hasNextPage: pagination?.hasNextPage ?? false,
    });
  } catch (err) {
    return handleFailure(err, "category");
  }
}

export async function getAllCategoriesStep(): Promise<
  ToolResult<GetAllCategoriesData>
> {
  "use step";
  try {
    const categories = await getCategories();
    return toolOk({
      categories: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        productCount: c.productCount,
      })),
    });
  } catch (err) {
    return handleFailure(err);
  }
}

export async function getProductDetailsStep(
  input: GetProductDetailsToolInput,
): Promise<ToolResult<ProductDetailsData>> {
  "use step";
  try {
    const p = await getProductById(input.productId);
    // Live stock is a nice-to-have: if only this lookup fails the product is
    // still valid, so the card shows without stock instead of failing.
    const stock = await getProductStock(p.id)
      .then((s) => ({ stock: s.stock, inStock: s.inStock, lowStock: s.lowStock }))
      .catch(() => null);
    return toolOk({
      product: {
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        price: p.price,
        currency: p.currency,
        priceDisplay: price(p.price, p.currency),
        category: p.category,
        images: p.images ?? [],
        tags: p.tags ?? [],
        featured: p.featured,
        href: `/products/${encodeURIComponent(p.slug)}`,
      },
      stock,
    });
  } catch (err) {
    return handleFailure(err, "product");
  }
}

/**
 * Validates the request against the real order, then starts the background
 * return workflow and returns right away.
 *
 * Duplicate protection: the run is started with a start hook keyed by the
 * order id. While a return for that order is still running, a second request
 * (double click, model retry, step replay) is refused by the workflow runtime
 * and answered with `duplicate: true` pointing at the existing run, so the
 * customer notification and refund pre-authorization cannot happen twice.
 */
export async function returnOrderStep(
  input: ReturnOrderToolInput,
): Promise<ToolResult<ReturnOrderData>> {
  "use step";
  try {
    const order = await getOrder(input.orderId);

    // Only fulfilled orders can be returned (the store API rejects the rest).
    if (order.status !== "fulfilled") {
      const why =
        order.status === "cancelled"
          ? "That order was cancelled, so there is nothing to return."
          : "That order hasn't been fulfilled yet, so it can't be returned.";
      return toolError("not_eligible", why);
    }

    // Default to the whole order; otherwise check every item against it.
    let items: ReturnOrderItem[];
    if (input.items && input.items.length > 0) {
      const ordered = new Map(order.items.map((i) => [i.productId, i.quantity]));
      const merged = new Map<string, number>();
      for (const item of input.items) {
        merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
      }
      for (const [productId, quantity] of merged) {
        const max = ordered.get(productId);
        if (max === undefined) {
          return toolError(
            "invalid_request",
            "One of those items isn't on that order, so no return was filed.",
          );
        }
        if (quantity > max) {
          return toolError(
            "invalid_request",
            "You can't return more units than were ordered, so no return was filed.",
          );
        }
      }
      items = [...merged].map(([productId, quantity]) => ({ productId, quantity }));
    } else {
      items = order.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
    }

    const data = {
      orderId: order.id,
      items,
      orderTotal: order.total,
      currency: order.currency,
    };

    try {
      const run = await start(
        returnFlow,
        [{ orderId: order.id, reason: input.reason, items }],
        { experimental_hook: { token: `return:${order.id}` } },
      );
      return toolOk<ReturnOrderData>({ status: "filed", returnRunId: run.runId, ...data });
    } catch (err) {
      if (HookConflictError.is(err)) {
        // The owner's run id is what the card polls. Without it we can't
        // show the existing return, so say so rather than invent one.
        if (!err.conflictingRunId) {
          return toolError(
            "unavailable",
            "A return for that order is already in progress, but I can't show its status right now.",
          );
        }
        return toolOk<ReturnOrderData>({
          status: "filed",
          duplicate: true,
          returnRunId: err.conflictingRunId,
          ...data,
        });
      }
      throw err;
    }
  } catch (err) {
    return handleFailure(err, "order");
  }
}
