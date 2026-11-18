import { z } from "zod";

/**
 * Input schemas for the shopping tools. Shared by lib/tools.ts (what the model
 * sees) and lib/workflows/steps/shop-steps.ts (what the steps accept).
 *
 * Every field has a `.describe()` and a length cap, so the model gets clear
 * guidance and a runaway value is rejected before it reaches the store API.
 */

export const searchProductsInput = z.object({
  query: z
    .string()
    .trim()
    .max(100)
    .optional()
    .describe(
      "Free-text search, for example 'hoodie' or 'black mug'. Leave out to browse the whole catalog.",
    ),
  category: z
    .string()
    .trim()
    .max(50)
    .optional()
    .describe(
      "Category slug to narrow the results, for example 'hoodies'. Get valid slugs from getAllCategories; never guess one.",
    ),
  page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Page number, starting at 1. Use it to show more results."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(24)
    .optional()
    .describe("Products per page. Defaults to 8."),
});

export const getAllCategoriesInput = z.object({});

export const getProductDetailsInput = z.object({
  productId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe(
      "Product id (for example 'hoodie_001') or slug (for example 'black-pullover-hoodie'), taken from a previous search result.",
    ),
});

export const returnOrderInput = z.object({
  orderId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "Order ids are letters, digits, '-' or '_'.")
    .describe("The order number the shopper gave you, for example '11111'."),
  reason: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .describe(
      "Why the shopper is returning the order, in their own words. Ask for it if they have not said.",
    ),
  items: z
    .array(
      z.object({
        productId: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .describe("Product id of an item on the order."),
        quantity: z
          .number()
          .int()
          .min(1)
          .max(99)
          .describe("How many units of that product to return."),
      }),
    )
    .max(50)
    .optional()
    .describe(
      "Only the items being returned. Leave out to return every item on the order.",
    ),
});

export type SearchProductsToolInput = z.infer<typeof searchProductsInput>;
export type GetProductDetailsToolInput = z.infer<typeof getProductDetailsInput>;
export type ReturnOrderToolInput = z.infer<typeof returnOrderInput>;
