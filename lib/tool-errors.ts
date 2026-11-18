// No `import "server-only"` here: this module is used inside workflow steps,
// which are bundled outside Next.js where that marker package can't resolve.
// It holds no secrets; it only maps errors to fixed strings.
import { ApiRequestError } from "@/lib/api";
import type { ToolError, ToolErrorCode } from "@/lib/shop/types";

export type { ToolError, ToolErrorCode } from "@/lib/shop/types";

/**
 * Turns any failure into a result that is safe to hand to the model and show
 * to a person.
 *
 * Why this exists: `lib/api.ts` appends the store API access value to every
 * request URL as a query string, and `ApiRequestError.details` can hold the
 * raw fetch error (which can contain that URL). Tool results end up in the
 * chat transcript, so they must NEVER include `error.details`, URLs, stack
 * traces, or the raw `error.message` of a network failure. Only the fixed
 * strings below leave this module.
 */

const MESSAGES: Record<ToolErrorCode, string> = {
  not_found: "I couldn't find that record.",
  invalid_request: "That request wasn't valid. Please check the details.",
  not_eligible: "That request isn't eligible.",
  rate_limited: "The store service is busy right now. Please try again shortly.",
  unavailable:
    "The store service isn't responding right now. Please try again in a moment.",
  unknown: "Something went wrong while looking that up.",
};

function classify(err: unknown): { code: ToolErrorCode; retryable: boolean } {
  if (!(err instanceof ApiRequestError)) {
    return { code: "unknown", retryable: false };
  }
  if (err.status === 0) return { code: "unavailable", retryable: true }; // network
  if (err.status === 404) return { code: "not_found", retryable: false };
  if (err.status === 429) return { code: "rate_limited", retryable: true };
  if (err.status >= 500) return { code: "unavailable", retryable: true };
  if (err.status >= 400) return { code: "invalid_request", retryable: false };
  return { code: "unknown", retryable: false };
}

/** True for failures worth retrying (network, 429, 5xx). Used by workflow steps. */
export function isTransientError(err: unknown): boolean {
  return classify(err).retryable;
}

/**
 * Map a thrown error to a tool result. Pass `subject` (for example
 * "product" or "order") to make the not_found message specific.
 */
export function toToolError(err: unknown, subject?: string): ToolError {
  const { code, retryable } = classify(err);
  const message =
    code === "not_found" && subject
      ? `I couldn't find that ${subject}.`
      : MESSAGES[code];
  return { success: false, error: { code, message, retryable } };
}

/** Build a ToolError for a known, expected condition (e.g. order not returnable). */
export function toolError(
  code: ToolErrorCode,
  message: string = MESSAGES[code],
  retryable = false,
): ToolError {
  return { success: false, error: { code, message, retryable } };
}

/** Wrap a successful value so every tool returns the same envelope. */
export function toolOk<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}
