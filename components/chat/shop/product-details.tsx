"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Boxes, CircleAlert, ImageOff, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProductDetailsData, ProductStockSummary } from "@/lib/shop/types";
import { safeHref, safeImageSrc, safePrice } from "@/components/chat/shop/format";

const focusRing =
  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring";

export function ProductDetails({ data }: { data: ProductDetailsData }) {
  const { product, stock } = data;
  const images = product.images
    .map((src) => safeImageSrc(src))
    .filter((src): src is string => src !== null);

  return (
    <article
      aria-labelledby={`product-${product.id}-name`}
      className="w-full overflow-hidden rounded-lg border border-border bg-card"
    >
      <ProductGallery images={images} name={product.name} />

      <div className="space-y-3 p-4">
        <header className="space-y-1">
          <h3 id={`product-${product.id}-name`} className="text-base font-semibold leading-snug text-foreground">
            {product.name}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {safePrice(product.price, product.currency)}
            </span>
            {product.category ? (
              <Badge variant="secondary" className="text-[11px] font-normal">
                {product.category}
              </Badge>
            ) : null}
            {product.featured ? (
              <Badge variant="outline" className="text-[11px] font-normal">
                Featured
              </Badge>
            ) : null}
          </div>
          <StockStatus stock={stock} />
        </header>

        {product.description ? (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {product.description}
          </p>
        ) : null}

        {product.tags.length > 0 ? (
          <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
            {product.tags.map((tag) => (
              <li key={tag}>
                <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                  {tag}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <Link
          href={safeHref(product.href, product.id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-foreground underline-offset-4 hover:underline",
            focusRing,
          )}
        >
          View product page
          <ArrowUpRight aria-hidden="true" className="size-4" />
          <span className="sr-only">for {product.name}</span>
        </Link>
      </div>
    </article>
  );
}

function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [index, setIndex] = useState(0);
  const current = images[Math.min(index, Math.max(images.length - 1, 0))];

  if (!current) {
    return (
      <div
        role="img"
        aria-label={`${name}: no image available`}
        className="flex aspect-[4/3] w-full items-center justify-center bg-secondary text-muted-foreground"
      >
        <ImageOff aria-hidden="true" className="size-6" />
      </div>
    );
  }

  return (
    <div className="space-y-2 bg-secondary p-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-background">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current}
          src={current}
          alt={images.length > 1 ? `${name}, image ${index + 1} of ${images.length}` : name}
          loading="lazy"
          decoding="async"
          className="size-full object-contain"
        />
      </div>
      {images.length > 1 ? (
        <div role="group" aria-label="Product images" className="flex gap-2 overflow-x-auto pb-0.5">
          {images.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              aria-label={`Show image ${i + 1}`}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
              className={cn(
                "size-14 shrink-0 overflow-hidden rounded-md border bg-background transition-colors",
                i === index ? "border-foreground" : "border-border hover:border-foreground/40",
                focusRing,
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StockStatus({ stock }: { stock: ProductStockSummary | null }) {
  if (!stock) {
    return (
      <StockLine
        tone="muted"
        icon={<CircleAlert aria-hidden="true" className="size-4" />}
        label="Stock unavailable"
        detail="Live stock could not be loaded. Check the product page."
      />
    );
  }
  if (!stock.inStock || stock.stock <= 0) {
    return (
      <StockLine
        tone="warning"
        icon={<TriangleAlert aria-hidden="true" className="size-4" />}
        label="Out of stock"
      />
    );
  }
  if (stock.lowStock) {
    return (
      <StockLine
        tone="warning"
        icon={<TriangleAlert aria-hidden="true" className="size-4" />}
        label={`Low stock: only ${stock.stock} left`}
      />
    );
  }
  return (
    <StockLine
      tone="ok"
      icon={<Boxes aria-hidden="true" className="size-4" />}
      label="In stock"
    />
  );
}

function StockLine({
  tone,
  icon,
  label,
  detail,
}: {
  tone: "ok" | "warning" | "muted";
  icon: React.ReactNode;
  label: string;
  detail?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 text-sm",
        tone === "warning" ? "text-destructive" : "text-foreground",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="font-medium">{label}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}

