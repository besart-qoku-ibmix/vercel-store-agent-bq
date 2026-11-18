"use client";

import { createContext, useContext } from "react";

export interface ShopChatContextValue {
  /** Sends a follow-up message as the shopper (used by chips and buttons). */
  sendText: (text: string) => void;
  /** True while a response is in flight; follow-up controls disable themselves. */
  busy: boolean;
}

const ShopChatContext = createContext<ShopChatContextValue>({
  sendText: () => {},
  busy: false,
});

export const ShopChatProvider = ShopChatContext.Provider;

export function useShopChat(): ShopChatContextValue {
  return useContext(ShopChatContext);
}
