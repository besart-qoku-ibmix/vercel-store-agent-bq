"use client";

import type { ToolUIPart } from "ai";
import { MessageResponse } from "@/components/ai-elements/message";
import type {
  GetAllCategoriesData,
  ProductDetailsData,
  ReturnOrderData,
  SearchProductsData,
  ShopUITools,
} from "@/lib/shop/types";
import type { ShopMessage } from "@/components/chat/shop/types";
import { Categories } from "@/components/chat/shop/categories";
import { ProductDetails } from "@/components/chat/shop/product-details";
import { ProductResults } from "@/components/chat/shop/product-results";
import { ReturnStatus } from "@/components/chat/shop/return-status";
import {
  CardSkeleton,
  ChipsSkeleton,
  type FollowUp,
  isToolError,
  isToolSuccess,
  ProductDetailsSkeleton,
  ProductGridSkeleton,
  ToolErrorCard,
  ToolFailedCard,
  ToolNotice,
  ToolProgress,
} from "@/components/chat/shop/tool-status";

type ShopToolPart = ToolUIPart<ShopUITools>;
type PartOf<NAME extends keyof ShopUITools> = Extract<ShopToolPart, { type: `tool-${NAME}` }>;

const CATEGORIES_FOLLOW_UP: FollowUp = {
  label: "Browse categories",
  message: "What categories do you have?",
};

/** Renders one message's parts in order. Unknown part types are ignored. */
export function MessageParts({
  message,
  isStreaming,
}: {
  message: ShopMessage;
  /** True for the assistant message that is currently streaming. */
  isStreaming: boolean;
}) {
  return (
    <>
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`;
        switch (part.type) {
          case "text": {
            if (!part.text) return null;
            if (message.role === "user") {
              return (
                <p key={key} className="whitespace-pre-wrap break-words">
                  {part.text}
                </p>
              );
            }
            return (
              <MessageResponse
                key={key}
                className="max-w-prose leading-relaxed"
                isAnimating={isStreaming && part.state === "streaming"}
              >
                {part.text}
              </MessageResponse>
            );
          }
          case "tool-searchProducts":
            return <SearchProductsPart key={key} part={part} />;
          case "tool-getAllCategories":
            return <GetAllCategoriesPart key={key} part={part} />;
          case "tool-getProductDetails":
            return <GetProductDetailsPart key={key} part={part} />;
          case "tool-returnOrder":
            return <ReturnOrderPart key={key} part={part} />;
          // reasoning, step-start, sources, data parts, dynamic tools: not shown.
          default:
            return null;
        }
      })}
    </>
  );
}

function isPending(state: ShopToolPart["state"]): boolean {
  return (
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-requested" ||
    state === "approval-responded"
  );
}

function SearchProductsPart({ part }: { part: PartOf<"searchProducts"> }) {
  const query = part.input?.query?.trim();
  const category = part.input?.category?.trim();
  if (isPending(part.state)) {
    const what = query ? ` for "${query}"` : category ? ` in ${category}` : "";
    return (
      <ToolProgress label={`Searching products${what}...`}>
        <ProductGridSkeleton />
      </ToolProgress>
    );
  }
  const retry: FollowUp = {
    label: "Try the search again",
    message: query ? `Search for ${query} again` : "Try that search again",
  };
  if (part.state === "output-error" || part.state === "output-denied") {
    return <ToolFailedCard what="search the catalog" retry={retry} />;
  }
  const output: unknown = part.output;
  if (isToolSuccess<SearchProductsData>(output) && Array.isArray(output.data.products)) {
    return <ProductResults data={output.data} categoriesFollowUp={CATEGORIES_FOLLOW_UP} />;
  }
  if (isToolError(output)) {
    return (
      <ToolErrorCard
        result={output}
        retry={retry}
        followUps={output.error?.code === "invalid_request" ? [CATEGORIES_FOLLOW_UP] : []}
      />
    );
  }
  return <ToolFailedCard what="search the catalog" retry={retry} />;
}

function GetAllCategoriesPart({ part }: { part: PartOf<"getAllCategories"> }) {
  if (isPending(part.state)) {
    return (
      <ToolProgress label="Loading categories...">
        <ChipsSkeleton />
      </ToolProgress>
    );
  }
  const retry: FollowUp = { label: "Try again", message: "What categories do you have?" };
  if (part.state === "output-error" || part.state === "output-denied") {
    return <ToolFailedCard what="load the categories" retry={retry} />;
  }
  const output: unknown = part.output;
  if (isToolSuccess<GetAllCategoriesData>(output) && Array.isArray(output.data.categories)) {
    return <Categories data={output.data} />;
  }
  if (isToolError(output)) return <ToolErrorCard result={output} retry={retry} />;
  return <ToolFailedCard what="load the categories" retry={retry} />;
}

function GetProductDetailsPart({ part }: { part: PartOf<"getProductDetails"> }) {
  const productId = part.input?.productId?.trim();
  if (isPending(part.state)) {
    return (
      <ToolProgress label="Loading product details...">
        <ProductDetailsSkeleton />
      </ToolProgress>
    );
  }
  const retry: FollowUp = {
    label: "Try again",
    message: productId ? `Show me details for ${productId}` : "Try loading that product again",
  };
  if (part.state === "output-error" || part.state === "output-denied") {
    return <ToolFailedCard what="load that product" retry={retry} />;
  }
  const output: unknown = part.output;
  if (isToolSuccess<ProductDetailsData>(output) && output.data.product) {
    return <ProductDetails data={output.data} />;
  }
  if (isToolError(output)) {
    if (output.error?.code === "not_found") {
      return (
        <ToolNotice
          title="Product not found"
          message={output.error.message}
          hint="It may have been renamed or removed. Try searching for it instead."
          followUps={[
            ...(productId
              ? [{ label: `Search for "${productId}"`, message: `Search for ${productId}` }]
              : []),
            CATEGORIES_FOLLOW_UP,
          ]}
        />
      );
    }
    return <ToolErrorCard result={output} retry={retry} />;
  }
  return <ToolFailedCard what="load that product" retry={retry} />;
}

function ReturnOrderPart({ part }: { part: PartOf<"returnOrder"> }) {
  const orderId = part.input?.orderId?.trim();
  if (isPending(part.state)) {
    return (
      <ToolProgress label={orderId ? `Checking order #${orderId}...` : "Checking your order..."}>
        <CardSkeleton />
      </ToolProgress>
    );
  }
  if (part.state === "output-error" || part.state === "output-denied") {
    // No retry button for a return: a retry could file the same return twice.
    return (
      <ToolFailedCard
        what="start your return"
        note="Check your order before trying again, so the return isn't filed twice."
      />
    );
  }
  const output: unknown = part.output;
  if (isToolSuccess<ReturnOrderData>(output) && typeof output.data.returnRunId === "string") {
    return <ReturnStatus data={output.data} />;
  }
  if (isToolError(output)) {
    const code = output.error?.code;
    const title =
      code === "not_found"
        ? "Order not found"
        : code === "not_eligible"
          ? "This order can't be returned"
          : undefined;
    if (title) {
      return (
        <ToolNotice
          title={title}
          message={output.error.message}
          hint={
            code === "not_found"
              ? "Check the order number on your confirmation email and try again."
              : "No return was filed."
          }
        />
      );
    }
    return <ToolErrorCard result={output} />;
  }
  return <ToolFailedCard what="start your return" />;
}
