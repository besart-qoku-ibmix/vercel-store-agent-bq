/** Id of the header robot button that opens the shopping assistant panel. */
export const AGENT_TRIGGER_ID = "agent-panel-trigger";
/** Attribute on the chat textarea so the panel can move focus into it. */
export const SHOP_INPUT_ATTR = "data-shop-chat-input";

/** True while AgentPanelSync is restoring `?chat=open` on first paint. */
export function isPanelBooting(): boolean {
  return document.documentElement.classList.contains("agent-panel-booting");
}

/**
 * Focuses the chat textarea. The textarea may not exist yet (panel content is
 * mounted lazily on mobile and after storage is read), so retry for a short
 * while instead of failing silently.
 */
export function focusShopComposer(maxFrames = 30): void {
  let frames = 0;
  const attempt = () => {
    const el = document.querySelector<HTMLTextAreaElement>(
      `textarea[${SHOP_INPUT_ATTR}]`,
    );
    if (el && !el.disabled && el.offsetParent !== null) {
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return;
    }
    if (++frames < maxFrames) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

/** Returns focus to the robot button that opened the panel. */
export function focusAgentTrigger(): void {
  document.getElementById(AGENT_TRIGGER_ID)?.focus({ preventScroll: true });
}
