/**
 * Copy artwork shared by the message footer and the code-block header.
 *
 * Taken verbatim from the desktop app's icon set (`IconCopyOutlineRegular` and
 * `IconCheckOutlineRegular` in `dsh-client-ui-primitives`): 16×16 outline, 1px
 * stroke. Markup strings rather than components because one consumer renders
 * React and the other builds the markdown HTML string.
 *
 * @module
 */

/** The copy glyph, as it appears on the desktop's copy buttons. */
export const COPY_ICON_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke-width="1" aria-hidden="true"><rect x="1.52075" y="4.07373" width="10.3932" height="10.3932" rx="2" stroke="currentColor"/><path d="M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z" fill="currentColor"/></svg>`

/** The confirmed state of the same button. */
export const COPIED_ICON_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke-width="1" aria-hidden="true"><path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" stroke="currentColor"/></svg>`
