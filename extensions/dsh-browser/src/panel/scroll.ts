/**
 * Scroll helpers for the conversation pane.
 *
 * @module
 */

/** True when the scrollport is within `threshold` px of its bottom edge. */
export function isNearScrollBottom(
  element: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  threshold = 48,
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
}

/**
 * Put the conversation scrollport back where the user left it.
 *
 * Leaving the panel (for example to open settings) unmounts the scrollport, so
 * it comes back at offset 0 — the first message. Restore the reading position:
 * a user who was following the newest row keeps following it, and a user who
 * had scrolled up gets their offset back.
 */
export function restoreConversationScroll(
  element: Pick<HTMLElement, 'scrollTop' | 'scrollHeight'>,
  state: { atBottom: boolean; offset: number },
): void {
  element.scrollTop = state.atBottom ? element.scrollHeight : state.offset
}
