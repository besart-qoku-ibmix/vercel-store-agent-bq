import { formatPrice } from "@/lib/format";

/**
 * formatPrice() throws a RangeError for an invalid currency code. Tool output
 * is data from the store API, so never let a bad value break the whole chat.
 */
export function safePrice(cents: number, currency: string | null | undefined): string {
  const amount = Number.isFinite(cents) ? cents : 0;
  try {
    return formatPrice(amount, currency || "USD");
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/** Only same-site relative links are allowed from tool output. */
export function safeHref(href: unknown, fallbackId?: string): string {
  if (typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) {
    return href;
  }
  return fallbackId ? `/products/${encodeURIComponent(fallbackId)}` : "/search";
}

/** Only https (or same-site) image URLs are rendered. */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== "string") return null;
  if (src.startsWith("https://")) return src;
  if (src.startsWith("/") && !src.startsWith("//")) return src;
  return null;
}
