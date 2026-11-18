"use client";

/**
 * Welcome! This is the chat panel you will edit for the workshop!
 *
 * During the workshop you'll connect it to a real agent: swap the
 * local `useState` for `useChat` from the AI SDK, point the form
 * at `sendMessage`, and render each message's `parts` inside
 * `<ConversationContent>`.
 *
 * Workshop docs: https://agent-foundations-certification.vercel.app/docs/chat-agent
 */

import { useChat } from "@ai-sdk/react";
import { LoaderCircle, MessageSquarePlus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  hasResumableRun,
  lastTurnHasReturn,
  openShopChat,
  retryShopChat,
  startNewShopChat,
  stopShopChat,
  type ShopChatSession,
} from "@/components/chat/shop/chat-store";
import { ShopChatProvider } from "@/components/chat/shop/chat-context";
import {
  focusAgentTrigger,
  focusShopComposer,
  isPanelBooting,
  SHOP_INPUT_ATTR,
} from "@/components/chat/shop/focus";
import { MessageParts } from "@/components/chat/shop/message-parts";
import type { ShopMessage } from "@/components/chat/shop/types";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

const STARTERS = [
  "What do you sell?",
  "Show me hoodies",
  "Find a mug",
  "I want to return an order",
];

const MAX_INPUT_LENGTH = 2000;

export function AgentChat() {
  const [session, setSession] = useState<ShopChatSession | null>(null);

  useEffect(() => {
    setSession(openShopChat());
  }, []);

  const newChat = useCallback(async () => {
    setSession(await startNewShopChat());
    focusShopComposer();
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
  return <ChatBody key={session.chatId} session={session} onNewChat={newChat} />;
}

/** Moves focus into the composer when the panel opens, and back to the robot button on close. */
function usePanelFocus() {
  const { open, openMobile, isMobile } = useSidebar();
  const isOpen = isMobile ? openMobile : open;
  const wasOpen = useRef<boolean | null>(null);

  useEffect(() => {
    const previous = wasOpen.current;
    wasOpen.current = isOpen;
    // First run: the panel may be restored open from ?chat=open on a refresh.
    // Don't steal focus then.
    if (previous === null) return;
    if (isOpen && !previous && !isPanelBooting()) {
      focusShopComposer();
    } else if (!isOpen && previous) {
      // The mobile sheet does not reliably hand focus back (it can end up on
      // <body>), so do it here for both layouts.
      focusAgentTrigger();
    }
  }, [isOpen, isMobile]);
}

function ChatBody({
  session,
  onNewChat,
}: {
  session: ShopChatSession;
  onNewChat: () => void;
}) {
  const { messages, status, error } = useChat<ShopMessage>({
    chat: session.chat,
    resume: true,
  });
  const [input, setInput] = useState("");
  usePanelFocus();

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

  const context = useMemo(() => ({ sendText, busy }), [sendText, busy]);

  // A failed turn that already called returnOrder must not be retried by
  // re-sending: it could file the return twice.
  const returnMayExist = error ? lastTurnHasReturn(session) && !hasResumableRun(session) : false;

  // A run that failed on the server (for example the model service refused
  // the request) still ends its stream cleanly, so there is no `error`: the
  // turn just finishes with no answer. Treat "finished with nothing to show"
  // as a failure too, so the shopper is never left with a blank reply.
  const answerShown =
    last?.role === "assistant" &&
    last.parts.some(
      (p) => (p.type === "text" && p.text.trim() !== "") || p.type.startsWith("tool-"),
    );
  const noAnswer = status === "ready" && last?.role !== undefined && !answerShown && !error;
  const failed = Boolean(error) || noAnswer;

  // Between a finished tool card and whatever comes next (another tool call,
  // or the written answer) the stream is open but nothing new is on screen
  // while the model decides. Say so, so the chat doesn't look stuck.
  const lastVisiblePart =
    last?.role === "assistant"
      ? [...last.parts].reverse().find((p) => p.type !== "step-start" && p.type !== "reasoning")
      : undefined;
  const betweenSteps =
    status === "streaming" &&
    lastVisiblePart !== undefined &&
    lastVisiblePart.type.startsWith("tool-") &&
    "state" in lastVisiblePart &&
    (lastVisiblePart.state === "output-available" ||
      lastVisiblePart.state === "output-error" ||
      lastVisiblePart.state === "output-denied");

  return (
    <ShopChatProvider value={context}>
      <div className="flex h-full min-h-0 flex-col">
        <Conversation className="flex-1">
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState
                title="How can I help?"
                description="Ask about products and categories, or return an order."
              />
            ) : (
              messages.map((message) => (
                <Message key={message.id} from={message.role}>
                  <MessageContent className={message.role === "assistant" ? "w-full" : undefined}>
                    <MessageParts
                      message={message}
                      isStreaming={status === "streaming" && message.id === last?.id}
                    />
                  </MessageContent>
                </Message>
              ))
            )}

            {status === "submitted" || betweenSteps ? (
              <p
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                {status === "submitted" ? "Thinking..." : "Working on it..."}
              </p>
            ) : null}

            {failed ? (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
              >
                <p className="text-foreground">
                  {returnMayExist
                    ? "Something went wrong. Check your order before trying again, so a return isn't filed twice."
                    : "Something went wrong and I couldn't finish that answer."}
                </p>
                {returnMayExist ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => void retryShopChat(session)}
                  >
                    <RotateCcw aria-hidden="true" />
                    Try again
                  </Button>
                )}
              </div>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="flex flex-col gap-3 border-t p-3">
          {messages.length === 0 ? (
            <Suggestions>
              {STARTERS.map((text) => (
                <Suggestion key={text} suggestion={text} onClick={sendText} disabled={busy} />
              ))}
            </Suggestions>
          ) : null}
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                {...{ [SHOP_INPUT_ATTR]: "" }}
                aria-label="Message the shop assistant"
                value={input}
                maxLength={MAX_INPUT_LENGTH}
                onChange={(e) => setInput(e.currentTarget.value)}
                placeholder="Ask about products or returns"
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
              </PromptInputTools>
              <PromptInputSubmit
                status={status}
                disabled={!busy && !input.trim()}
                onStop={() => void stopShopChat(session)}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </ShopChatProvider>
  );
}
