import type { UIDataTypes, UIMessage } from "ai";
import type { ShopUITools } from "@/lib/shop/types";

/** Chat message type with the shopping tool map, so tool parts are typed. */
export type ShopMessage = UIMessage<unknown, UIDataTypes, ShopUITools>;
