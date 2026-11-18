import type { UIDataTypes, UIMessage } from "ai";
import type { AdminUITools } from "@/lib/admin/types";

/** Chat message type with the admin tool map, so tool parts are typed. */
export type AdminMessage = UIMessage<unknown, UIDataTypes, AdminUITools>;
