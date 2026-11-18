/**
 * Browser-side persistence for the shopping chat (sessionStorage).
 *
 * What is stored, and why:
 * - `chatId`        stable id for the conversation (survives refresh).
 * - `messages`      COMPLETED conversation state only. Partial assistant output
 *                   is never persisted while it streams; it is rebuilt by
 *                   replaying the active workflow run instead (see
 *                   components/agent-chat.tsx).
 * - `activeRunId`   workflow run id of the turn that is still in flight, taken
 *                   from the `x-workflow-run-id` response header. It is what
 *                   lets a refreshed page reconnect to the SAME run instead of
 *                   POSTing the message again.
 * - previous chats  "New chat" moves the conversation into a small archive in
 *                   localStorage (see the bottom of this file).
 *
 * Nothing secret is stored here: only chat messages the shopper already sees,
 * and an opaque run id. Every access is wrapped in try/catch because storage
 * can be unavailable (private mode, blocked site data) or full; the chat must
 * keep working without it.
 *
 * Client-only module. Do not import from server code.
 */
import type { UIMessage } from "ai";

const STORAGE_KEY = "ship-it-shop:shop-chat:v1";
/** Ignore stored runs older than this: they are finished or long gone. */
const MAX_RUN_AGE_MS = 30 * 60 * 1000;
/** Keep stored history bounded so we stay far under the ~5 MB quota. */
const MAX_STORED_MESSAGES = 60;
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface StoredShopChat {
  version: 1;
  chatId: string;
  messages: UIMessage[];
  activeRunId: string | null;
  /** Epoch ms when `activeRunId` was recorded. */
  activeRunStartedAt: number | null;
  updatedAt: number;
}

export function createChatId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `shop_${crypto.randomUUID()}`;
    }
  } catch {
    // fall through
  }
  return `shop_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function isValidRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID_PATTERN.test(value);
}

function isStoredMessage(value: unknown): value is UIMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    (m.role === "user" || m.role === "assistant" || m.role === "system") &&
    Array.isArray(m.parts)
  );
}

function readRaw(): StoredShopChat | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (p.version !== 1 || typeof p.chatId !== "string" || !p.chatId) {
      return null;
    }
    const messages = Array.isArray(p.messages)
      ? p.messages.filter(isStoredMessage)
      : [];
    const runId = isValidRunId(p.activeRunId) ? p.activeRunId : null;
    const startedAt =
      typeof p.activeRunStartedAt === "number" ? p.activeRunStartedAt : null;
    return {
      version: 1,
      chatId: p.chatId,
      messages,
      activeRunId: runId,
      activeRunStartedAt: runId ? startedAt : null,
      updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function writeRaw(value: StoredShopChat): void {
  const attempt = (messages: UIMessage[]) => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...value, messages, updatedAt: Date.now() }),
    );
  };
  try {
    attempt(value.messages.slice(-MAX_STORED_MESSAGES));
  } catch {
    try {
      // Quota or serialization problem: keep only the recent tail.
      attempt(value.messages.slice(-10));
    } catch {
      // Storage unavailable: the chat still works, it just won't survive a refresh.
    }
  }
}

/**
 * Loads the stored chat, or creates and stores an empty one. Safe to call
 * twice in a row (React StrictMode): the second call returns the same chat.
 */
export function loadOrCreateShopChat(): StoredShopChat {
  const existing = readRaw();
  if (existing) return existing;
  const fresh: StoredShopChat = {
    version: 1,
    chatId: createChatId(),
    messages: [],
    activeRunId: null,
    activeRunStartedAt: null,
    updatedAt: Date.now(),
  };
  writeRaw(fresh);
  return fresh;
}

/** The run id that is safe to resume, or null when it is missing or stale. */
export function getResumableRunId(chat: StoredShopChat): string | null {
  if (!chat.activeRunId || chat.activeRunStartedAt == null) return null;
  if (Date.now() - chat.activeRunStartedAt > MAX_RUN_AGE_MS) return null;
  return chat.activeRunId;
}

/** Reads the current active run id straight from storage (used at reconnect time). */
export function readActiveRunId(): string | null {
  const chat = readRaw();
  return chat ? getResumableRunId(chat) : null;
}

/**
 * Records that a turn started: persists the history including the new user
 * message plus the run id of the workflow that is now answering it.
 */
export function saveTurnStarted(
  chatId: string,
  messages: UIMessage[],
  runId: string | null,
): void {
  writeRaw({
    version: 1,
    chatId,
    messages,
    activeRunId: isValidRunId(runId) ? runId : null,
    activeRunStartedAt: isValidRunId(runId) ? Date.now() : null,
    updatedAt: Date.now(),
  });
}

/**
 * Persists settled messages (called when the chat is idle: ready or error).
 * `clearRun: true` also forgets the active run (the turn is complete or the
 * shopper stopped it).
 */
export function saveMessages(
  chatId: string,
  messages: UIMessage[],
  options: { clearRun: boolean },
): void {
  const current = readRaw();
  const keepRun = !options.clearRun && current?.chatId === chatId;
  writeRaw({
    version: 1,
    chatId,
    messages,
    activeRunId: keepRun ? (current?.activeRunId ?? null) : null,
    activeRunStartedAt: keepRun ? (current?.activeRunStartedAt ?? null) : null,
    updatedAt: Date.now(),
  });
}

/** Forgets the active run id only (e.g. a failed resume must not loop). */
export function clearActiveRun(chatId: string): void {
  const current = readRaw();
  if (!current || current.chatId !== chatId) return;
  writeRaw({ ...current, activeRunId: null, activeRunStartedAt: null });
}

/** Wipes the stored conversation ("New chat"). */
export function clearShopChat(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Previous chats. "New chat" archives the conversation instead of dropping it.
// The archive is in localStorage so it survives closing the tab; the chat in
// progress stays in sessionStorage. Archived chats are finished history: they
// carry no run id, so reopening one never reconnects to or restarts a run.
// ---------------------------------------------------------------------------

const ARCHIVE_KEY = "ship-it-shop:shop-chat-archive:v1";
const MAX_ARCHIVED_CHATS = 10;
const MAX_TITLE_LENGTH = 60;

interface ArchivedShopChat {
  chatId: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
}

export interface ArchivedChatSummary {
  chatId: string;
  title: string;
  updatedAt: number;
}

function readArchive(): ArchivedShopChat[] {
  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): ArchivedShopChat[] => {
      const c = item as Partial<ArchivedShopChat> | null;
      if (
        !c ||
        typeof c.chatId !== "string" ||
        typeof c.title !== "string" ||
        typeof c.updatedAt !== "number" ||
        !Array.isArray(c.messages)
      ) {
        return [];
      }
      return [
        {
          chatId: c.chatId,
          title: c.title,
          updatedAt: c.updatedAt,
          messages: c.messages.filter(isStoredMessage),
        },
      ];
    });
  } catch {
    return [];
  }
}

function writeArchive(list: ArchivedShopChat[]): void {
  try {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list));
  } catch {
    try {
      // Quota problem: keep only the newest few.
      window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list.slice(0, 3)));
    } catch {
      // Storage unavailable: previous chats just won't be kept.
    }
  }
}

/** Saves a finished or abandoned conversation to the archive (newest first). */
export function archiveShopChat(chatId: string, messages: UIMessage[]): void {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return;
  const title =
    firstUser.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TITLE_LENGTH) || "Chat";
  const entry: ArchivedShopChat = {
    chatId,
    title,
    updatedAt: Date.now(),
    messages: messages.slice(-MAX_STORED_MESSAGES),
  };
  writeArchive(
    [entry, ...readArchive().filter((c) => c.chatId !== chatId)].slice(
      0,
      MAX_ARCHIVED_CHATS,
    ),
  );
}

export function listArchivedChats(): ArchivedChatSummary[] {
  return readArchive().map(({ chatId, title, updatedAt }) => ({
    chatId,
    title,
    updatedAt,
  }));
}

/**
 * Moves an archived chat back into the current-chat slot. Returns false when
 * it no longer exists. The caller opens it with `openShopChat()` afterwards.
 */
export function restoreArchivedChat(chatId: string): boolean {
  const list = readArchive();
  const found = list.find((c) => c.chatId === chatId);
  if (!found) return false;
  writeArchive(list.filter((c) => c.chatId !== chatId));
  writeRaw({
    version: 1,
    chatId: found.chatId,
    messages: found.messages,
    activeRunId: null,
    activeRunStartedAt: null,
    updatedAt: Date.now(),
  });
  return true;
}
