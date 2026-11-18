"use client";

import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type ArchivedChatSummary, listArchivedChats } from "@/lib/shop/client-storage";

/**
 * "Previous chats" menu: chats the shopper moved away from with "New chat".
 * The list is read from the browser on mount and each time the menu opens, and
 * the button is hidden when there is nothing to show.
 */
export function PreviousChats({ onOpen }: { onOpen: (chatId: string) => void }) {
  const [chats, setChats] = useState<ArchivedChatSummary[]>([]);

  useEffect(() => {
    setChats(listArchivedChats());
  }, []);

  if (chats.length === 0) return null;

  return (
    <DropdownMenu onOpenChange={(open) => open && setChats(listArchivedChats())}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Open a previous chat"
          title="Previous chats"
        >
          <History aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Product details and stock in old chats may be out of date.
        </DropdownMenuLabel>
        {chats.map((chat) => (
          <DropdownMenuItem key={chat.chatId} onSelect={() => onOpen(chat.chatId)}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{chat.title}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(chat.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
