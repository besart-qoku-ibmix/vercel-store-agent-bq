/**
 * This is where the tools for your agent will live.
 *
 * During the workshop you'll define tools in this file that your agents
 * will choose to run depending on the question or request that is made
 * to them.
 *
 * Workshop docs: https://agent-foundations-certification.vercel.app/docs/tools
 */

import {
  getAllCategoriesInput,
  getProductDetailsInput,
  returnOrderInput,
  searchProductsInput,
} from "@/lib/shop/schemas";
import {
  getAllCategoriesStep,
  getProductDetailsStep,
  returnOrderStep,
  searchProductsStep,
} from "@/lib/workflows/steps/shop-steps";

export const shopTools = {
  searchProducts: {
    description:
      "Search the product catalog by text and/or category, or browse everything when no filter is given. Returns product cards for the chat, with prices and links. An empty result is normal: say so.",
    inputSchema: searchProductsInput,
    execute: searchProductsStep,
  },
  getAllCategories: {
    description:
      "Get the store's current product categories (slug, name, product count). Use it to answer 'what do you sell?' and to find valid category slugs for searchProducts.",
    inputSchema: getAllCategoriesInput,
    execute: getAllCategoriesStep,
  },
  getProductDetails: {
    description:
      "Get full details for ONE product the shopper asked about: description, price, images, tags and live stock. Renders a large details card, so do NOT use it to browse, search, compare or list products (use searchProducts). Accepts a product id or slug from a search result.",
    inputSchema: getProductDetailsInput,
    execute: getProductDetailsStep,
  },
  returnOrder: {
    description:
      "File a return for an order. Needs the order number and the reason. Looks up the order, then starts the return in the background (customer notification, refund pre-authorization, filing) and answers immediately. Returns success with status 'filed', or an error such as not_found or not_eligible. Does NOT mean the refund is approved.",
    inputSchema: returnOrderInput,
    execute: returnOrderStep,
  },
};
