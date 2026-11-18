"use client";

/**
 * Welcome! This is the chat panel you will edit for the workshop!
 *
 * During the workshop you'll connect it to a real agent: swap the
 * local `useState` for `useChat` from the AI SDK, point the form
 * at `sendMessage`, and render each message's `parts` inside
 * `<ConversationContent>`.
 *
 * Workshop docs: https://agent-foundations-certification.vercel.app/docs/admin-chat-agent
 */
import { useChat } from "@ai-sdk/react";
import { LoaderCircle, MessageSquarePlus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
  type AdminChatSession,
  openAdminChat,
  openArchivedAdminChat,
  retryAdminChat,
  startNewAdminChat,
  stopAdminChat,
} from "@/components/chat/admin/admin-chat-store";
import { AdminMessageParts } from "@/components/chat/admin/message-parts";
import { AdminPreviousChats } from "@/components/chat/admin/previous-chats";
import type { AdminMessage } from "@/components/chat/admin/types";
import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "Which products have the highest return rate?",
  "Which top sellers are low on stock?",
  "Show open urgent support tickets",
  "Summarize this week's revenue",
  "What did we decide about returns last time?",
];

const MAX_INPUT_LENGTH = 2000;

/** Moves focus into the message box (it may not be mounted yet, so retry briefly). */
function focusComposer(maxFrames = 30) {
  let frames = 0;
  const attempt = () => {
    const el = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Message the admin agent"]',
    );
    if (el && !el.disabled) {
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return;
    }
    if (++frames < maxFrames) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

export function AdminAgentChat() {
  const [session, setSession] = useState<AdminChatSession | null>(null);

  useEffect(() => {
    setSession(openAdminChat());
  }, []);

  const newChat = useCallback(async () => {
    setSession(await startNewAdminChat());
    focusComposer();
  }, []);

  const openChat = useCallback(async (chatId: string) => {
    setSession(await openArchivedAdminChat(chatId));
    focusComposer();
  }, []);

  if (!session) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle aria-hidden="true" className="mr-2 size-4 animate-spin motion-reduce:animate-none" />
        Loading chat...
      </div>
    );
  }

  // key: a new chat is a new Chat instance, so useChat must rebind.
  return <ChatBody key={session.chatId} session={session} onNewChat={newChat} onOpenChat={openChat} />;
}

function ChatBody({
  session,
  onNewChat,
  onOpenChat,
}: {
  session: AdminChatSession;
  onNewChat: () => void;
  onOpenChat: (chatId: string) => void;
}) {
  const { messages, status, error } = useChat<AdminMessage>({
    chat: session.chat,
    resume: true,
  });
  const [input, setInput] = useState("");

  const busy = status === "submitted" || status === "streaming";
  const last = messages[messages.length - 1];

  const sendText = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean || session.chat.status === "submitted" || session.chat.status === "streaming") {
        return;
      }
      void session.chat.sendMessage({ text: clean });
    },
    [session],
  );

  const handleSubmit = (message: PromptInputMessage) => {
    const text = message.text?.trim();
    if (!text || busy) return;
    sendText(text);
    setInput("");
  };

  // A run that failed on the server (for example the model service refused
  // the request) still ends its stream cleanly, so there is no `error`: the
  // turn just finishes with nothing to show. Treat that as a failure too.
  const answerShown =
    last?.role === "assistant" &&
    last.parts.some(
      (p) => (p.type === "text" && p.text.trim() !== "") || p.type.startsWith("tool-"),
    );
  const noAnswer = status === "ready" && last?.role !== undefined && !answerShown && !error;
  const failed = Boolean(error) || noAnswer;

  // Between a finished tool card and the next step (another tool, or the
  // written answer), and before the first card, nothing new is on screen
  // while the model decides. Empty text parts (the model often opens one next
  // to its tool calls) and hidden parts don't count as something on screen.
  const lastVisiblePart =
    last?.role === "assistant"
      ? [...last.parts]
          .reverse()
          .find(
            (p) =>
              p.type !== "step-start" &&
              p.type !== "reasoning" &&
              !(p.type === "text" && p.text.trim() === ""),
          )
      : undefined;
  const betweenSteps =
    status === "streaming" &&
    (lastVisiblePart === undefined ||
      (lastVisiblePart.type.startsWith("tool-") &&
        "state" in lastVisiblePart &&
        (lastVisiblePart.state === "output-available" ||
          lastVisiblePart.state === "output-error" ||
          lastVisiblePart.state === "output-denied")));
  const waitingText =
    status === "submitted" || lastVisiblePart === undefined ? "Thinking..." : "Working on it...";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="How can I help with the store?"
              description="Ask about support tickets, returns, inventory or sales. I only read store data and can't change anything."
            />
          ) : (
            messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent className={message.role === "assistant" ? "w-full" : undefined}>
                  <AdminMessageParts
                    message={message}
                    isStreaming={status === "streaming" && message.id === last?.id}
                  />
                </MessageContent>
              </Message>
            ))
          )}

          {status === "submitted" || betweenSteps ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
              {waitingText}
            </p>
          ) : null}

          {failed ? (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            >
              <p className="text-foreground">Something went wrong and I couldn&apos;t finish that answer.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => void retryAdminChat(session)}
              >
                <RotateCcw aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="flex flex-col gap-3 border-t p-3">
        {messages.length === 0 ? (
          <Suggestions>
            {SUGGESTIONS.map((text) => (
              <Suggestion key={text} suggestion={text} onClick={sendText} disabled={busy} />
            ))}
          </Suggestions>
        ) : null}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              aria-label="Message the admin agent"
              value={input}
              maxLength={MAX_INPUT_LENGTH}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask about tickets, returns, inventory or sales"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              {messages.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onNewChat}
                  aria-label="Start a new chat"
                >
                  <MessageSquarePlus aria-hidden="true" />
                  New chat
                </Button>
              ) : null}
              <AdminPreviousChats onOpen={onOpenChat} />
            </PromptInputTools>
            <PromptInputSubmit
              status={status}
              disabled={!busy && !input.trim()}
              onStop={() => void stopAdminChat(session)}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
