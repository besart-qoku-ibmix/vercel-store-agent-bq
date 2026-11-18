"use client";

import { Button } from "@/components/ui/button";
import type { GetAllCategoriesData } from "@/lib/shop/types";
import { useShopChat } from "@/components/chat/shop/chat-context";
import { ToolNotice } from "@/components/chat/shop/tool-status";

/** Result of getAllCategories: chips that send a follow-up message when pressed. */
export function Categories({ data }: { data: GetAllCategoriesData }) {
  const { sendText, busy } = useShopChat();
  const categories = data.categories ?? [];

  if (categories.length === 0) {
    return (
      <ToolNotice
        title="No categories to show"
        hint="The store didn't return any categories. You can still search for products by name."
        followUps={[{ label: "Show all products", message: "Show me all products" }]}
      />
    );
  }

  return (
    <section aria-label="Product categories" className="w-full space-y-2">
      <p className="text-sm text-muted-foreground">
        {`${categories.length} categor${categories.length === 1 ? "y" : "ies"}. Pick one to browse it.`}
      </p>
      <ul className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <li key={category.slug}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              className="h-auto min-h-8 rounded-full whitespace-normal"
              onClick={() => sendText(`Show me ${category.name}`)}
              aria-label={`Show me ${category.name}, ${category.productCount} product${category.productCount === 1 ? "" : "s"}`}
            >
              <span>{category.name}</span>
              <span aria-hidden="true" className="text-muted-foreground">
                {category.productCount}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
