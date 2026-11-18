"use client";

import Link from "next/link";
import { ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProductSummary, SearchProductsData } from "@/lib/shop/types";
import { safeHref, safeImageSrc, safePrice } from "@/components/chat/shop/format";
import { type FollowUp, ToolNotice } from "@/components/chat/shop/tool-status";

const focusRing =
  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring";

/** Result of searchProducts: a browsable grid, or an honest empty state. */
export function ProductResults({
  data,
  categoriesFollowUp,
}: {
  data: SearchProductsData;
  /** Offers a way to browse categories when the search came back empty. */
  categoriesFollowUp?: FollowUp;
}) {
  const shown = data.products.length;
  const termLabel = describeFilters(data);

  if (shown === 0) {
    return (
      <ToolNotice
        title={termLabel ? `No products matched ${termLabel}` : "No products found"}
        hint="Try another term, or browse the categories."
        followUps={[
          ...(categoriesFollowUp ? [categoriesFollowUp] : []),
          { label: "Show all products", message: "Show me all products" },
        ]}
      />
    );
  }

  return (
    <section aria-label="Product results" className="w-full space-y-3">
      <p className="text-sm text-muted-foreground" aria-live="off">
        {`Showing ${shown} of ${data.total} product${data.total === 1 ? "" : "s"}`}
        {termLabel ? ` for ${termLabel}` : ""}
        {data.hasNextPage ? ". Ask for more to see the next page." : "."}
      </p>

      <ul className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
        {data.products.map((product) => (
          <li key={product.id} className="min-w-0">
            <ProductResultCard product={product} />
          </li>
        ))}
      </ul>

      {data.hasNextPage ? (
        <p className="text-xs text-muted-foreground">
          Page {data.page} of {data.totalPages}. Ask for "more" or "the next page".
        </p>
      ) : null}
    </section>
  );
}

function describeFilters(data: SearchProductsData): string {
  const parts: string[] = [];
  if (data.query) parts.push(`"${data.query}"`);
  if (data.category) parts.push(`the ${data.category} category`);
  return parts.join(" in ");
}

function ProductResultCard({ product }: { product: ProductSummary }) {
  const src = safeImageSrc(product.image);
  const href = safeHref(product.href, product.id);
  const price = safePrice(product.price, product.currency);
  return (
    <Link
      href={href}
      aria-label={`${product.name}, ${price}`}
      className={cn(
        "group block h-full overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20",
        focusRing,
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-secondary">
        {src ? (
          // Store images come from a remote blob host; plain <img> keeps the
          // chat free of layout-sizing quirks. Fixed aspect ratio prevents CLS.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <div
            role="img"
            aria-label={`${product.name}: no image available`}
            className="flex size-full items-center justify-center text-muted-foreground"
          >
            <ImageOff aria-hidden="true" className="size-6" />
          </div>
        )}
      </div>
      <div className="space-y-1.5 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {product.name}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{price}</span>
          {product.category ? (
            <Badge variant="secondary" className="max-w-full truncate text-[11px] font-normal">
              {product.category}
            </Badge>
          ) : null}
        </div>
        <span className="block text-xs font-medium text-foreground underline-offset-4 group-hover:underline">
          View product
        </span>
      </div>
    </Link>
  );
}
