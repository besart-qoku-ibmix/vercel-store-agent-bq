"use client";

/**
 * Client-side owner of the shopping chat: one AI SDK `Chat` per conversation,
 * kept at module scope so it survives the panel unmounting (on mobile the
 * Sheet unmounts its content when closed; on resize the sidebar switches
 * between Sheet and desktop panel). A useChat-owned Chat would be stopped on
 * unmount, cutting the stream; an external Chat keeps streaming.
 *
 * Refresh / reconnect design (see also lib/shop/client-storage.ts):
 *
 * 1. POST /api/chat starts ONE workflow run per user turn and returns its id in
 *    `x-workflow-run-id`. `onChatSendMessage` stores
 *    { history incl. the new user message, activeRunId } in sessionStorage.
 *    Partial assistant output is never persisted.
 * 2. When the turn settles (finish, user stop, or a non-connection error),
 *    `onFinish` stores the final messages AND clears activeRunId in a single
 *    write, so there is no moment where the run is forgotten but its answer
 *    is not yet saved (that is why the clear happens here and not in the
 *    transport's onChatEnd, which fires just before).
 * 3. After a refresh, the stored history ends with the user message of the
 *    unfinished turn. `useChat({ resume: true })` calls reconnectToStream,
 *    which GETs /api/chat/{activeRunId}/stream?startIndex=0. The stream of that
 *    run holds exactly one assistant message (that turn), so replaying it from
 *    0 rebuilds it once: earlier turns come from storage, this turn from the
 *    replay. No POST is made, so no work starts again (tools are not re-run;
 *    the replay only reads the durable stream).
 *    A negative startIndex would be wrong here: it would drop the beginning of
 *    the message we never persisted (the orphan filter discards the deltas).
 * 4. Same-page disconnects: the transport reconnects on its own from the last
 *    chunk index it saw. If it gives up, the run id is kept and the Retry
 *    button / tab-visibility resume reconnects again. `resumeStreamIsReplay`
 *    tells the AI SDK that a resume replays from the start, so it resets the
 *    partial message on the first `start` chunk instead of appending to it,
 *    and reconnectToStream below drops any partial copy left on screen.
 * 5. Retry after a failure never re-POSTs a turn whose return was already
 *    filed (see retryShopChat), so a retry cannot file a second return.
 * 6. "New chat" archives the conversation (see client-storage.ts) instead of
 *    deleting it; openArchivedShopChat() brings one back as the current chat.
 */
import { Chat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import { type ChatTransport, isToolUIPart, type UIMessage } from "ai";
import {
  archiveShopChat,
  clearActiveRun,
  clearShopChat,
  getResumableRunId,
  isValidRunId,
  loadOrCreateShopChat,
  readActiveRunId,
  restoreArchivedChat,
  saveMessages,
  saveTurnStarted,
} from "@/lib/shop/client-storage";
import type { ShopMessage } from "@/components/chat/shop/types";

const CHAT_API = "/api/chat";

export interface ShopChatSession {
  chatId: string;
  chat: Chat<ShopMessage>;
  /** In-memory copy of the active run id (fallback when storage is unavailable). */
  runId: string | null;
  /** Set right before a user-initiated stop, so onFinish can tell it from other aborts. */
  userStopped: boolean;
  /** True when the last error looked like a lost connection (the run may still be going). */
  connectionLost: boolean;
}

let current: ShopChatSession | null = null;

export function getCurrentShopChat(): ShopChatSession | null {
  return current;
}

/** Returns the session for the stored conversation, creating it on first use. */
export function openShopChat(): ShopChatSession {
  const stored = loadOrCreateShopChat();
  if (current && current.chatId === stored.chatId) return current;

  const resumableRunId = getResumableRunId(stored);
  if (stored.activeRunId && !resumableRunId) clearActiveRun(stored.chatId);

  current = createSession(
    stored.chatId,
    stored.messages as ShopMessage[],
    resumableRunId,
  );
  return current;
}

/** Stops the current response and moves the conversation to "Previous chats". */
async function leaveCurrentChat(): Promise<void> {
  const previous = current;
  current = null;
  if (previous) {
    previous.userStopped = true;
    await previous.chat.stop().catch(() => {});
    archiveShopChat(previous.chatId, sanitizeMessages(previous.chat.messages));
  }
  clearShopChat();
}

/** "New chat": keeps the current conversation in the archive and starts fresh. */
export async function startNewShopChat(): Promise<ShopChatSession> {
  await leaveCurrentChat();
  return openShopChat();
}

/** Reopens a chat from "Previous chats" (the current one is archived first). */
export async function openArchivedShopChat(chatId: string): Promise<ShopChatSession> {
  await leaveCurrentChat();
  restoreArchivedChat(chatId);
  return openShopChat();
}

/** Stop pressed by the shopper. */
export async function stopShopChat(session: ShopChatSession): Promise<void> {
  session.userStopped = true;
  await session.chat.stop();
}

/** True when there is server-side work this chat can reconnect to. */
export function hasResumableRun(session: ShopChatSession): boolean {
  return Boolean(readActiveRunId() ?? session.runId);
}

/**
 * Tool parts that never got a result (stopped mid-call) and empty assistant
 * messages are dropped before the history is sent or persisted, so the model
 * never receives a dangling tool call.
 */
export function sanitizeMessages<M extends UIMessage>(messages: M[]): M[] {
  const result: M[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") {
      result.push(message);
      continue;
    }
    const parts = message.parts.filter(
      (part) =>
        !isToolUIPart(part) ||
        part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "output-denied",
    );
    if (parts.length === 0) continue;
    result.push(parts.length === message.parts.length ? message : { ...message, parts });
  }
  return result;
}

function isConnectionError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  // Thrown by WorkflowChatTransport after repeated reconnect failures. The
  // message is only inspected here, never shown.
  return (
    error instanceof Error && error.message.startsWith("Failed to reconnect after")
  );
}

function createSession(
  chatId: string,
  messages: ShopMessage[],
  runId: string | null,
): ShopChatSession {
  const session = {
    chatId,
    runId,
    userStopped: false,
    connectionLost: false,
  } as ShopChatSession;

  const activeRunId = () => readActiveRunId() ?? session.runId;

  const workflowTransport = new WorkflowChatTransport<ShopMessage>({
    api: CHAT_API,
    maxConsecutiveErrors: 4,
    // Replay a resumed run from its first chunk (see header comment, point 3).
    initialStartIndex: 0,
    prepareSendMessagesRequest: ({ messages: outgoing, body }) => ({
      body: { messages: sanitizeMessages(outgoing), ...(body ?? {}) },
    }),
    onChatSendMessage: (response, options) => {
      const header = response.headers.get("x-workflow-run-id");
      session.runId = isValidRunId(header) ? header : null;
      saveTurnStarted(chatId, sanitizeMessages(options.messages), session.runId);
    },
    prepareReconnectToStreamRequest: ({ api }) => {
      const id = activeRunId();
      return { api: id ? `${CHAT_API}/${encodeURIComponent(id)}/stream` : api };
    },
  });

  const transport: ChatTransport<ShopMessage> = {
    // Our resumes replay the run from chunk 0: let the AI SDK reset the
    // partial message on the first `start` chunk so nothing is duplicated.
    resumeStreamIsReplay: true,
    sendMessages: (options) => {
      session.connectionLost = false;
      session.userStopped = false;
      return workflowTransport.sendMessages(options);
    },
    reconnectToStream: async (options) => {
      // Nothing in flight: tell useChat there is nothing to resume (no error).
      if (!activeRunId()) return null;
      session.connectionLost = false;
      session.userStopped = false;
      // The active run answers the LAST user message, and the replay below
      // rebuilds that whole answer from chunk 0. Drop any partial copy of it
      // that is still on screen (e.g. after a failed reconnect) so the replay
      // cannot add a second one. The SDK reads `lastMessage` only after this
      // call resolves, so the trimmed list is what it builds on.
      const list = session.chat.messages;
      const lastUser = list.findLastIndex((m) => m.role === "user");
      if (lastUser !== -1 && lastUser < list.length - 1) {
        session.chat.messages = list.slice(0, lastUser + 1);
      }
      return workflowTransport.reconnectToStream({ ...options, startIndex: 0 });
    },
  };

  session.chat = new Chat<ShopMessage>({
    id: chatId,
    messages,
    transport,
    onError: (error) => {
      session.connectionLost = isConnectionError(error);
    },
    onFinish: ({ messages: finalMessages, isAbort, isDisconnect, isError }) => {
      if (current !== session) return; // a newer chat replaced this one
      const interruptedByUs = isAbort && !session.userStopped;
      const mayStillBeRunning =
        isDisconnect || (isError && session.connectionLost) || interruptedByUs;
      session.userStopped = false;
      if (mayStillBeRunning) {
        // Keep activeRunId and do not persist partial output: a later resume
        // replays the run and rebuilds this answer exactly once.
        return;
      }
      session.runId = null;
      saveMessages(chatId, sanitizeMessages(finalMessages), { clearRun: true });
    },
  });

  return session;
}

/** True when the last turn already called returnOrder (a return may be filed). */
export function lastTurnHasReturn(session: ShopChatSession): boolean {
  const list = session.chat.messages;
  const lastUser = list.findLastIndex((m) => m.role === "user");
  const turn = lastUser === -1 ? [] : list.slice(lastUser + 1);
  return turn.some((m) =>
    m.parts.some((p) => p.type === "tool-returnOrder"),
  );
}

/**
 * Retry after a chat-level failure, without repeating work:
 * - if a run is still known, reconnect to it (no new POST, nothing re-runs);
 * - otherwise regenerate, but never when the failed turn already called
 *   returnOrder: re-running it could file the same return twice. The caller
 *   checks lastTurnHasReturn() first and shows a safe message instead.
 */
export async function retryShopChat(session: ShopChatSession): Promise<void> {
  session.chat.clearError();
  if (hasResumableRun(session)) {
    await session.chat.resumeStream();
    return;
  }
  if (lastTurnHasReturn(session)) return;
  await session.chat.regenerate();
}
