/**
 * Tools for the store admin agent. Kept apart from lib/tools.ts so shopping
 * code never imports (or can even reach) back-office data, the sandbox or
 * memory. Import this file only from the admin agent.
 *
 * All store tools are read-only. There is deliberately no tool that changes
 * inventory, resolves tickets or issues refunds.
 */
import {
  bashInput,
  getInventoryStockInput,
  getReturnsHistoryInput,
  getSalesAnalyticsInput,
  getSupportTicketsInput,
  saveMemoryInput,
} from "@/lib/admin/schemas";
import { getAllCategoriesInput, searchProductsInput } from "@/lib/shop/schemas";
import {
  bashStep,
  getInventoryStockStep,
  getReturnsHistoryStep,
  getSalesAnalyticsStep,
  getSupportTicketsStep,
  saveMemoryStep,
} from "@/lib/workflows/steps/admin-steps";
import { getAllCategoriesStep, searchProductsStep } from "@/lib/workflows/steps/shop-steps";

export const adminTools = {
  getSupportTickets: {
    description:
      "Support tickets from the back office, with filters for date window, status, priority, category and assignee. Returns a preview of the newest rows, the window the store applied, and a sandbox `file` holding ALL fetched rows for bash. Read-only.",
    inputSchema: getSupportTicketsInput,
    execute: getSupportTicketsStep,
  },
  getReturnsHistory: {
    description:
      "Historical returns with filters for date window, status, decision and a row limit. Each row has the order, items, reason, decision and refund amount. Returns a preview, the window, and a sandbox `file` with ALL fetched rows for bash. Read-only: it can't approve, reject or refund anything.",
    inputSchema: getReturnsHistoryInput,
    execute: getReturnsHistoryStep,
  },
  getInventoryStock: {
    description:
      "Current stock per product, sorted lowest first, with filters for product ids, low stock and in stock. Paginated: check `hasNextPage` and `totalPages`. Returns a preview and a sandbox `file` with the rows of this page for bash. Read-only: it can't change stock.",
    inputSchema: getInventoryStockInput,
    execute: getInventoryStockStep,
  },
  getSalesAnalytics: {
    description:
      "Sales per product for a date window (units sold, orders, revenue), best sellers first, optionally for one product. Returns a preview, the window, `totals` for the whole window, and a sandbox `file` with ALL product rows for bash.",
    inputSchema: getSalesAnalyticsInput,
    execute: getSalesAnalyticsStep,
  },
  searchProducts: {
    description:
      "Search the public catalog by text and/or category to find product ids and names before combining back-office data. Use getAllCategories for valid category slugs.",
    inputSchema: searchProductsInput,
    execute: searchProductsStep,
  },
  getAllCategories: {
    description:
      "The store's current product categories (slug, name, product count). Use it to find valid category slugs.",
    inputSchema: getAllCategoriesInput,
    execute: getAllCategoriesStep,
  },
  bash: {
    description:
      "Run a bash command or short script in the isolated admin sandbox to calculate results. Data files from the back-office tools are JSON arrays in /vercel/sandbox/data (use the `file` path the tool returned). `jq` and `python3` are installed; there is no network. Use this for ALL arithmetic, totals, rates, rankings and joins between datasets: never calculate in your head. Prints stdout, stderr and the exit code. A non-zero exit code means the command failed: fix it and retry.",
    inputSchema: bashInput,
    execute: bashStep,
  },
  saveMemory: {
    description:
      "Save ONE short note to persistent memory, so it is available in later conversations. Use it only for an employee's lasting preference, a correction of a wrong assumption, or lasting business context they told you. Never for store data (it changes), one-off questions, or anything secret.",
    inputSchema: saveMemoryInput,
    execute: saveMemoryStep,
  },
};
