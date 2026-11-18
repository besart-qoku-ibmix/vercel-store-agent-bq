"use client";

import { X } from "lucide-react";
import { AgentChat } from "@/components/agent-chat";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

export function AgentSidebar() {
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar();
  const isOpen = isMobile ? openMobile : open;

  return (
    <Sidebar side="right" collapsible="offcanvas">
      <SidebarHeader>
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <span className="text-sm font-semibold">Ship It Shop Agent</span>
          {/* The mobile sheet's built-in close button is hidden by the sidebar
              component, so give touch and screen-reader users a visible one. */}
          {isMobile ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => setOpenMobile(false)}
            >
              <X aria-hidden="true" />
              <span className="sr-only">Close assistant</span>
            </Button>
          ) : null}
        </div>
      </SidebarHeader>
      {/* A closed desktop panel only slides off-screen, so without `inert` its
          controls would stay in the tab order. */}
      <SidebarContent className="overflow-hidden p-0" inert={!isOpen}>
        <AgentChat />
      </SidebarContent>
    </Sidebar>
  );
}
