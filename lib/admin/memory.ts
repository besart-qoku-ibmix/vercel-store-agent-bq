/**
 * Pure helpers for the admin memory file (no I/O, no secrets).
 *
 * The file lives in the admin sandbox (see lib/admin/sandbox.ts) and looks like:
 *
 *   # Store admin memory
 *   - [2026-11-18 correction] Revenue questions mean paid and fulfilled orders only.
 *
 * One bullet per note. Memory holds preferences, corrections and business
 * context only: store data is always fetched fresh, never remembered.
 */
import { ADMIN_PASSWORD } from "@/lib/admin-auth";
import type { SaveMemoryInput } from "@/lib/admin/types";

export const MEMORY_PATH = "/vercel/sandbox/memory.md";
export const MEMORY_HEADER = "# Store admin memory\n";
/** Saving is refused past this size, so memory can't grow without bound. */
export const MAX_MEMORY_CHARS = 6000;
/** What is handed to the agent at most (the newest part wins). */
export const MAX_MEMORY_PROMPT_CHARS = 6000;

const NOTE_LINE = /^- \[\d{4}-\d{2}-\d{2} [a-z_]+\] (.+)$/;

/** Collapses whitespace and case, so a reworded-by-spacing note counts as a duplicate. */
export function normalizeNote(note: string): string {
  return note.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Single line, no markdown bullets or control characters. */
export function cleanNote(note: string): string {
  return note
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatNoteLine(kind: SaveMemoryInput["kind"], note: string, date: string): string {
  return `- [${date} ${kind}] ${note}`;
}

export function noteLines(file: string): string[] {
  return file.split("\n").filter((line) => NOTE_LINE.test(line));
}

export function hasNote(file: string, note: string): boolean {
  const wanted = normalizeNote(note);
  return noteLines(file).some((line) => {
    const text = NOTE_LINE.exec(line)?.[1] ?? "";
    return normalizeNote(text) === wanted;
  });
}

// Credential-looking content must never be written to memory: it would be
// handed back to the model (and shown in chat) in every later conversation.
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{10,}/i,
  /\beyJ[A-Za-z0-9_-]{15,}/,
  /\bbearer\s+\S{8,}/i,
  /\b(pass(word|phrase)|secret|api[ _-]?key|private[ _-]?key|credential)/i,
  /x-vercel-protection-bypass/i,
];

/** True when the note looks like (or contains) a credential. */
export function looksSecret(note: string): boolean {
  if (SECRET_PATTERNS.some((p) => p.test(note))) return true;
  const exact = [
    ADMIN_PASSWORD,
    process.env.BYPASS_SECRET,
    process.env.CUSTOM_AI_API_KEY,
    process.env.VERCEL_OIDC_TOKEN,
  ];
  return exact.some((value) => Boolean(value) && note.includes(value as string));
}

/** What the agent is given: the notes only, newest kept when the file is large. */
export function memoryForPrompt(file: string | null): string | null {
  if (!file) return null;
  const lines = noteLines(file);
  if (lines.length === 0) return null;
  let text = lines.join("\n");
  if (text.length > MAX_MEMORY_PROMPT_CHARS) {
    text = text.slice(text.length - MAX_MEMORY_PROMPT_CHARS);
    text = text.slice(text.indexOf("\n") + 1); // drop the cut-off first line
  }
  return text;
}
