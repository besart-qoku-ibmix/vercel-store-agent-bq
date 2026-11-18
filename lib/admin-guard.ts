import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "@/lib/admin-auth";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** True when the request carries a valid admin session cookie. */
export async function isAdminRequest(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(ADMIN_COOKIE_NAME)?.value;
  return typeof value === "string" && safeEqual(value, ADMIN_PASSWORD);
}

/**
 * Call at the top of every admin API route (chat, stream resume, anything
 * that touches back-office data or the sandbox). Returns a 401 Response to
 * send back, or null when the caller is allowed.
 *
 *   const denied = await requireAdmin();
 *   if (denied) return denied;
 *
 * `proxy.ts` also blocks unauthenticated /api/admin/* requests; this check is
 * the second layer, so a proxy matcher mistake cannot expose an admin route.
 */
export async function requireAdmin(): Promise<Response | null> {
  if (await isAdminRequest()) return null;
  return Response.json(
    { error: "unauthorized", message: "Admin sign-in required." },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}
