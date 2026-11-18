"use client";

/**
 * Client-side owner of the admin chat: one AI SDK `Chat`, kept at module scope
 * so it survives the component unmounting and keeps streaming.
 *
 * Same reconnect design as the shopping chat (components/chat/shop/chat-store.ts),
 * pointed at the admin routes:
 *
 * 1. POST /api/admin/chat starts ONE workflow run per employee message and
 *    returns its id in `x-workflow-run-id`. We store { history, activeRunId }.
 * 2. When the turn settles, the final messages are stored and the run id is
 *    cleared in a single write.
 * 3. After a refresh the stored history ends with the unfinished user message.
 *    `useChat({ resume: true })` GETs /api/admin/chat/{runId}/stream?startIndex=0,
 *    which replays that run's one assistant message from its first chunk. No
 *    POST is made, so no work starts again.
 * 4. Retry: admin tools are read-only and `saveMemory` is idempotent, so
 *    regenerating a turn is safe (unlike the shopping chat's returnOrder).
 */
import { Chat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import { type ChatTransport, isToolUIPart, type UIMessage } from "ai";
import {
  archiveAdminChat,
  clearActiveRun,
  clearAdminChat,
  getResumableRunId,
  isValidRunId,
  loadOrCreateAdminChat,
  readActiveRunId,
  restoreArchivedAdminChat,
  saveMessages,
  saveTurnStarted,
} from "@/lib/admin/client-storage";
import type { AdminMessage } from "@/components/chat/admin/types";

const CHAT_API = "/api/admin/chat";

export interface AdminChatSession {
  chatId: string;
  chat: Chat<AdminMessage>;
  /** In-memory copy of the active run id (fallback when storage is unavailable). */
  runId: string | null;
  /** Set right before a user-initiated stop, so onFinish can tell it from other aborts. */
  userStopped: boolean;
  /** True when the last error looked like a lost connection (the run may still be going). */
  connectionLost: boolean;
}

let current: AdminChatSession | null = null;

/** Returns the session for the stored conversation, creating it on first use. */
export function openAdminChat(): AdminChatSession {
  const stored = loadOrCreateAdminChat();
  if (current && current.chatId === stored.chatId) return current;

  const resumableRunId = getResumableRunId(stored);
  if (stored.activeRunId && !resumableRunId) clearActiveRun(stored.chatId);

  current = createSession(stored.chatId, stored.messages as AdminMessage[], resumableRunId);
  return current;
}

/** Stops the current response and moves the conversation to "Previous chats". */
async function leaveCurrentChat(): Promise<void> {
  const previous = current;
  current = null;
  if (previous) {
    previous.userStopped = true;
    await previous.chat.stop().catch(() => {});
    archiveAdminChat(previous.chatId, sanitizeMessages(previous.chat.messages));
  }
  clearAdminChat();
}

/** "New chat": keeps the current conversation in the archive and starts fresh. */
export async function startNewAdminChat(): Promise<AdminChatSession> {
  await leaveCurrentChat();
  return openAdminChat();
}

/** Reopens a chat from "Previous chats" (the current one is archived first). */
export async function openArchivedAdminChat(chatId: string): Promise<AdminChatSession> {
  await leaveCurrentChat();
  restoreArchivedAdminChat(chatId);
  return openAdminChat();
}

export async function stopAdminChat(session: AdminChatSession): Promise<void> {
  session.userStopped = true;
  await session.chat.stop();
}

/** True when there is server-side work this chat can reconnect to. */
export function hasResumableRun(session: AdminChatSession): boolean {
  return Boolean(readActiveRunId() ?? session.runId);
}

/**
 * Tool parts that never got a result (stopped mid-call) and empty assistant
 * messages are dropped before the history is sent or stored, so the model
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
  // Thrown by WorkflowChatTransport after repeated reconnect failures. Only
  // inspected here, never shown.
  return error instanceof Error && error.message.startsWith("Failed to reconnect after");
}

function createSession(
  chatId: string,
  messages: AdminMessage[],
  runId: string | null,
): AdminChatSession {
  const session = { chatId, runId, userStopped: false, connectionLost: false } as AdminChatSession;
  const activeRunId = () => readActiveRunId() ?? session.runId;

  const workflowTransport = new WorkflowChatTransport<AdminMessage>({
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

  const transport: ChatTransport<AdminMessage> = {
    // Our resumes replay the run from chunk 0: let the AI SDK reset the
    // partial message on the first `start` chunk so nothing is duplicated.
    resumeStreamIsReplay: true,
    sendMessages: (options) => {
      session.connectionLost = false;
      session.userStopped = false;
      return workflowTransport.sendMessages(options);
    },
    reconnectToStream: async (options) => {
      if (!activeRunId()) return null; // nothing in flight: not an error
      session.connectionLost = false;
      session.userStopped = false;
      // The run answers the LAST employee message and the replay rebuilds that
      // whole answer from chunk 0, so drop any partial copy still on screen.
      const list = session.chat.messages;
      const lastUser = list.findLastIndex((m) => m.role === "user");
      if (lastUser !== -1 && lastUser < list.length - 1) {
        session.chat.messages = list.slice(0, lastUser + 1);
      }
      return workflowTransport.reconnectToStream({ ...options, startIndex: 0 });
    },
  };

  session.chat = new Chat<AdminMessage>({
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
      if (mayStillBeRunning) return; // keep the run id; a resume rebuilds the answer
      session.runId = null;
      saveMessages(chatId, sanitizeMessages(finalMessages), { clearRun: true });
    },
  });

  return session;
}

/** Retry after a failure: reconnect to a known run, otherwise regenerate (read-only, safe). */
export async function retryAdminChat(session: AdminChatSession): Promise<void> {
  session.chat.clearError();
  if (hasResumableRun(session)) {
    await session.chat.resumeStream();
    return;
  }
  await session.chat.regenerate();
}
