/**
 * Browser-side persistence for the admin chat (sessionStorage).
 *
 * Separate from the shopping chat's storage (lib/shop/client-storage.ts): its
 * own key and its own chat ids, so the two conversations never mix, even in
 * the same tab.
 *
 * Stored: a stable `chatId`, the COMPLETED messages, and `activeRunId`, the
 * workflow run of the turn still in flight (from `x-workflow-run-id`), which
 * is what lets a refreshed page reconnect to the SAME run instead of POSTing
 * again. Partial assistant output is never stored; a resume replays the run.
 *
 * Nothing secret is stored: only messages the employee already sees and an
 * opaque run id. Every access is wrapped in try/catch because storage can be
 * unavailable or full; the chat must keep working without it.
 *
 * Client-only module. Do not import from server code.
 */
import type { UIMessage } from "ai";

const STORAGE_KEY = "ship-it-shop:admin-chat:v1";
/** Ignore stored runs older than this: they are finished or long gone. */
const MAX_RUN_AGE_MS = 30 * 60 * 1000;
const MAX_STORED_MESSAGES = 40;
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface StoredAdminChat {
  version: 1;
  chatId: string;
  messages: UIMessage[];
  activeRunId: string | null;
  activeRunStartedAt: number | null;
}

export function createAdminChatId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `admin_${crypto.randomUUID()}`;
    }
  } catch {
    // fall through
  }
  return `admin_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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

function readRaw(): StoredAdminChat | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown> | null;
    if (!p || p.version !== 1 || typeof p.chatId !== "string" || !p.chatId) return null;
    const runId = isValidRunId(p.activeRunId) ? p.activeRunId : null;
    return {
      version: 1,
      chatId: p.chatId,
      messages: Array.isArray(p.messages) ? p.messages.filter(isStoredMessage) : [],
      activeRunId: runId,
      activeRunStartedAt:
        runId && typeof p.activeRunStartedAt === "number" ? p.activeRunStartedAt : null,
    };
  } catch {
    return null;
  }
}

function writeRaw(value: StoredAdminChat): void {
  const attempt = (messages: UIMessage[]) =>
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...value, messages }));
  try {
    attempt(value.messages.slice(-MAX_STORED_MESSAGES));
  } catch {
    try {
      attempt(value.messages.slice(-8)); // quota: keep only the recent tail
    } catch {
      // Storage unavailable: the chat works, it just won't survive a refresh.
    }
  }
}

/** Loads the stored chat, or creates and stores an empty one. */
export function loadOrCreateAdminChat(): StoredAdminChat {
  const existing = readRaw();
  if (existing) return existing;
  const fresh: StoredAdminChat = {
    version: 1,
    chatId: createAdminChatId(),
    messages: [],
    activeRunId: null,
    activeRunStartedAt: null,
  };
  writeRaw(fresh);
  return fresh;
}

/** The run id that is safe to resume, or null when it is missing or stale. */
export function getResumableRunId(chat: StoredAdminChat): string | null {
  if (!chat.activeRunId || chat.activeRunStartedAt == null) return null;
  return Date.now() - chat.activeRunStartedAt > MAX_RUN_AGE_MS ? null : chat.activeRunId;
}

export function readActiveRunId(): string | null {
  const chat = readRaw();
  return chat ? getResumableRunId(chat) : null;
}

/** A turn started: persist the history incl. the new message, plus its run id. */
export function saveTurnStarted(chatId: string, messages: UIMessage[], runId: string | null): void {
  writeRaw({
    version: 1,
    chatId,
    messages,
    activeRunId: isValidRunId(runId) ? runId : null,
    activeRunStartedAt: isValidRunId(runId) ? Date.now() : null,
  });
}

/** Persist settled messages. `clearRun` also forgets the active run. */
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
  });
}

/** Forget the active run id only (a failed resume must not loop). */
export function clearActiveRun(chatId: string): void {
  const current = readRaw();
  if (!current || current.chatId !== chatId) return;
  writeRaw({ ...current, activeRunId: null, activeRunStartedAt: null });
}

/** Wipes the stored conversation ("New chat"). */
export function clearAdminChat(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Previous chats. "New chat" archives the conversation instead of dropping it.
// Same design as the shopping chat's archive (lib/shop/client-storage.ts), with
// its own key. The archive is in localStorage so it survives closing the tab;
// the chat in progress stays in sessionStorage. Archived chats are finished
// history: they carry no run id, so reopening one never reconnects to or
// restarts a run.
// ---------------------------------------------------------------------------

const ARCHIVE_KEY = "ship-it-shop:admin-chat-archive:v1";
const MAX_ARCHIVED_CHATS = 10;
const MAX_TITLE_LENGTH = 60;

interface ArchivedAdminChat {
  chatId: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
}

export interface ArchivedAdminChatSummary {
  chatId: string;
  title: string;
  updatedAt: number;
}

function readArchive(): ArchivedAdminChat[] {
  try {
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): ArchivedAdminChat[] => {
      const c = item as Partial<ArchivedAdminChat> | null;
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

function writeArchive(list: ArchivedAdminChat[]): void {
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
export function archiveAdminChat(chatId: string, messages: UIMessage[]): void {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return;
  const title =
    firstUser.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TITLE_LENGTH) || "Chat";
  const entry: ArchivedAdminChat = {
    chatId,
    title,
    updatedAt: Date.now(),
    messages: messages.slice(-MAX_STORED_MESSAGES),
  };
  writeArchive(
    [entry, ...readArchive().filter((c) => c.chatId !== chatId)].slice(0, MAX_ARCHIVED_CHATS),
  );
}

export function listArchivedAdminChats(): ArchivedAdminChatSummary[] {
  return readArchive().map(({ chatId, title, updatedAt }) => ({ chatId, title, updatedAt }));
}

/**
 * Moves an archived chat back into the current-chat slot. Returns false when
 * it no longer exists. The caller opens it with `openAdminChat()` afterwards.
 */
export function restoreArchivedAdminChat(chatId: string): boolean {
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
  });
  return true;
}

