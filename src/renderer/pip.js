/**
 * Floating-bubble (PiP) helpers shared by the panels that live inside the
 * bubble window.
 *
 * The collapsed bubble is a real 56×248 (vertical) or 280×52 (horizontal)
 * window. Any side panel — media library, recording settings — is 320–360px
 * wide, so opening one there just paints a slab of panel background over the
 * whole window (a black box in dark mode) with the pill and its buttons
 * unreachable underneath. Those panels therefore grow the bubble first.
 */

export function isCollapsedBubble() {
  return !!(document.body && document.body.classList.contains("pip-collapsed"));
}

/**
 * Make room for a full-width panel. Returns true when the bubble had to be
 * expanded (so callers can note that the window is about to resize).
 */
export function ensureRoomForPanel() {
  if (!isCollapsedBubble()) return false;
  document.body.classList.remove("pip-collapsed");
  try {
    if (window.api && window.api.pip && window.api.pip.expand) window.api.pip.expand();
  } catch {}
  return true;
}
