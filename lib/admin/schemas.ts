import { z } from "zod";

/**
 * Input schemas for the admin tools. Shared by lib/admin-tools.ts (what the
 * model sees) and lib/workflows/steps/admin-steps.ts (what the steps accept).
 *
 * Enums mirror the store's real back-office values (reference/store-openapi.json),
 * not the starter's `Return.status` type, which disagrees with the API.
 */

const dateString = z
  .string()
  .trim()
  .max(40)
  .regex(
    /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    "Use YYYY-MM-DD or an ISO 8601 datetime.",
  )
  .refine((v) => !Number.isNaN(Date.parse(v)), "That is not a real date.");

const from = dateString
  .optional()
  .describe(
    "Start of the date window, inclusive: YYYY-MM-DD (UTC start of day) or an ISO 8601 datetime. Defaults to 30 days before `to`. The store keeps about 180 days of history.",
  );

const to = dateString
  .optional()
  .describe(
    "End of the date window, inclusive: YYYY-MM-DD (UTC end of day) or an ISO 8601 datetime. Defaults to now.",
  );

export const getSupportTicketsInput = z.object({
  from,
  to,
  status: z
    .enum(["open", "pending", "resolved", "closed"])
    .optional()
    .describe("Only tickets in this status."),
  priority: z
    .enum(["low", "normal", "high", "urgent"])
    .optional()
    .describe("Only tickets with this priority."),
  category: z
    .enum([
      "shipping",
      "returns",
      "product_quality",
      "sizing",
      "billing",
      "payment",
      "account",
      "other",
    ])
    .optional()
    .describe("Only tickets in this category."),
  assignee: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,40}$/, "Staff usernames are letters, digits, '.', '-' or '_'.")
    .optional()
    .describe(
      "Staff username, for example 'alex'. Unassigned tickets are left out when this is set.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Most tickets to fetch, 1 to 500. Defaults to 100."),
});

export const getReturnsHistoryInput = z.object({
  from,
  to,
  status: z
    .enum(["pending", "processing", "completed"])
    .optional()
    .describe(
      "Only returns in this lifecycle status. Only 'completed' returns have a decision and a refund amount.",
    ),
  decision: z
    .enum(["approved", "rejected", "needs_info"])
    .optional()
    .describe("Only returns with this decision. Implies status 'completed'."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Most returns to fetch, 1 to 500. Defaults to 200."),
});

export const getInventoryStockInput = z.object({
  productIds: z
    .array(z.string().trim().min(1).max(100))
    .max(50)
    .optional()
    .describe(
      "Only these product ids (for example 'hoodie_001'). Find ids with searchProducts. Leave out for every product.",
    ),
  lowStock: z
    .boolean()
    .optional()
    .describe(
      "true: only products running low (1 to 5 units, not zero). false: only products that are not running low.",
    ),
  inStock: z
    .boolean()
    .optional()
    .describe(
      "true: only products with at least one unit. false: only out-of-stock products.",
    ),
  page: z.number().int().min(1).max(1000).optional().describe("Page number, starting at 1."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Products per page, 1 to 200. Defaults to 100."),
});

export const getSalesAnalyticsInput = z.object({
  from,
  to,
  productId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Only this product (an id such as 'hoodie_001'). Leave out for every product, sorted by units sold.",
    ),
});

export const bashInput = z.object({
  command: z
    .string()
    .trim()
    .min(1)
    .max(8000)
    .describe(
      "A bash command or short script, run with `bash -lc` in /vercel/sandbox. Read data files from /vercel/sandbox/data. `jq` and `python3` are available. There is no network.",
    ),
});

export const saveMemoryInput = z.object({
  note: z
    .string()
    .trim()
    .min(5)
    .max(300)
    .describe(
      "One short, self-contained sentence to remember, written so it makes sense in a later conversation.",
    ),
  kind: z
    .enum(["preference", "correction", "business_context"])
    .describe(
      "preference: how the employee likes answers. correction: the employee fixed a wrong assumption. business_context: a lasting fact about how the store works.",
    ),
});

export type GetSupportTicketsToolInput = z.infer<typeof getSupportTicketsInput>;
export type GetReturnsHistoryToolInput = z.infer<typeof getReturnsHistoryInput>;
export type GetInventoryStockToolInput = z.infer<typeof getInventoryStockInput>;
export type GetSalesAnalyticsToolInput = z.infer<typeof getSalesAnalyticsInput>;
export type BashToolInput = z.infer<typeof bashInput>;
export type SaveMemoryToolInput = z.infer<typeof saveMemoryInput>;
