/**
 * Inline @tab references in the composer (@标签页).
 *
 * The user picks a tab from the picker and the composer carries an inline
 * `@标题` token; at submit time the referenced tab's text is captured and
 * appended AFTER the user's words inside the same nonce-fenced boundary as
 * every snapshot. User words come first on purpose: the host derives session
 * titles from the beginning of the first human message, so leading context
 * blocks would corrupt the title.
 *
 * The composed text is what the transcript stores, so the panel parses its
 * own format back into chips. Parsing survives a session resume, where the
 * only record of the attachment is the message itself. Every field the parser
 * reads is a labelled header line above the page text, so page text can never
 * be mistaken for metadata by ending with the right sentence.
 *
 * @module
 */

import { wrapUntrustedContent } from '../security/untrusted.ts'

const TAB_HEADER = '[referenced browser tab] The user referenced this browser tab as additional context for the message above.'
const TITLE_LABEL = 'Source title: '
const URL_LABEL = 'Source URL: '
const TAB_ID_LABEL = 'Tab ID: '
const TEXT_LABEL = 'Page text:'
const UNAVAILABLE_NOTE = '(the page DOM is protected or inaccessible; only tab metadata is included)'
const OPEN_PREFIX = '<UNTRUSTED_PAGE_CONTENT nonce="'
const TAB_BLOCK_MAX_CHARS = 12_000
/** Hard ceiling on how many tabs one message can reference. */
export const MAX_TAB_MENTIONS = 8

/** One referenced tab as chosen in the composer. */
export interface TabMention {
  tabId: number
  title: string
  url: string
}

/** A referenced tab plus the context captured at submit time. */
export interface TabMentionContext {
  mention: TabMention
  /** Page text, or null when the DOM could not be read. */
  text: string | null
}

function mentionBlock({ mention, text }: TabMentionContext): string {
  const body = [
    `${TITLE_LABEL}${mention.title === '' ? '(untitled page)' : mention.title}`,
    `${URL_LABEL}${mention.url === '' ? '(unknown URL)' : mention.url}`,
    `${TAB_ID_LABEL}${String(mention.tabId)}`,
    text === null ? UNAVAILABLE_NOTE : `${TEXT_LABEL}\n${text}`,
  ].join('\n')
  return `${TAB_HEADER}\n${wrapUntrustedContent(body, TAB_BLOCK_MAX_CHARS)}`
}

/**
 * Parse consecutive mention blocks at the very start of `text`.
 * @returns the mentions and the unconsumed remainder, or null when the text
 * does not start with a parseable mention block.
 */
function parseMentionBlocks(text: string): { mentions: TabMention[]; rest: string } | null {
  if (!text.startsWith(TAB_HEADER)) return null
  const mentions: TabMention[] = []
  let rest = text
  while (rest.startsWith(TAB_HEADER)) {
    const afterHeader = rest.slice(TAB_HEADER.length)
    // wrapUntrustedContent() puts a Security preamble line between the header
    // and the fence, so the fence is searched, never assumed at a fixed offset.
    const openStart = afterHeader.indexOf(OPEN_PREFIX)
    if (openStart === -1) break
    const nonceStart = openStart + OPEN_PREFIX.length
    const nonceEnd = afterHeader.indexOf('">\n', nonceStart)
    if (nonceEnd === -1) break
    const nonce = afterHeader.slice(nonceStart, nonceEnd)
    const closing = `\n</UNTRUSTED_PAGE_CONTENT nonce="${nonce}">`
    const bodyStart = nonceEnd + '">\n'.length
    const bodyEnd = afterHeader.indexOf(closing, bodyStart)
    if (bodyEnd === -1) break
    const lines = afterHeader.slice(bodyStart, bodyEnd).split('\n')
    const titleLine = lines.find((line) => line.startsWith(TITLE_LABEL))
    const urlLine = lines.find((line) => line.startsWith(URL_LABEL))
    const idLine = lines.find((line) => line.startsWith(TAB_ID_LABEL))
    if (titleLine === undefined || urlLine === undefined || idLine === undefined) break
    const tabId = Number(idLine.slice(TAB_ID_LABEL.length))
    if (!Number.isSafeInteger(tabId) || tabId < 0) break
    mentions.push({
      tabId,
      title: titleLine.slice(TITLE_LABEL.length),
      url: urlLine.slice(URL_LABEL.length),
    })
    rest = afterHeader.slice(bodyEnd + closing.length)
    // The wrapper repeats its Security notice after the closing fence; skip it
    // so the next block or nothing starts directly.
    if (rest.startsWith('\nSecurity: ')) {
      const lineEnd = rest.indexOf('\n', 1)
      if (lineEnd !== -1) rest = rest.slice(lineEnd + 1)
      else rest = ''
      if (rest.startsWith('\n')) rest = rest.slice(1)
    } else if (rest.startsWith('\n\n')) {
      rest = rest.slice(2)
    }
  }
  if (mentions.length === 0) return null
  return { mentions, rest }
}

/**
 * Compose the prompt text for a message that references other tabs: the
 * user's own words first (session titles derive from the first message),
 * then the fenced tab blocks.
 * @param mentions - captured contexts in composer order.
 * @param message - what the user typed, or a selection-framed text; may be empty.
 */
export function tabMentionPromptText(mentions: readonly TabMentionContext[], message: string): string {
  const prefix = mentions.slice(0, MAX_TAB_MENTIONS).map(mentionBlock).join('\n\n')
  return message === '' ? prefix : `${message}\n\n${prefix}`
}

/**
 * Recover referenced tabs and the user's words from a composed message whose
 * mention blocks sit at the tail.
 * @param text - a stored user message.
 * @returns the parts, or null when the message carries no tab mention.
 */
export function splitTabMentionMessage(text: string): { mentions: TabMention[]; message: string } | null {
  // A mention block may only begin at the very start or right after a blank
  // line, so a page-authored occurrence of the header inside a fence body can
  // never be mistaken for a real block boundary. The trailing run is the
  // leftmost boundary position whose blocks consume the rest of the text.
  const candidates: number[] = []
  let at = text.indexOf(TAB_HEADER)
  while (at !== -1) {
    if (at === 0 || (at >= 2 && text.slice(at - 2, at) === '\n\n')) candidates.push(at)
    at = text.indexOf(TAB_HEADER, at + 1)
  }
  for (const start of candidates) {
    const parsed = parseMentionBlocks(text.slice(start))
    if (parsed !== null && parsed.rest === '') {
      return {
        mentions: parsed.mentions,
        message: start === 0 ? '' : text.slice(0, start - 2),
      }
    }
  }
  return null
}

/** Label a mention's origin: the page title, else its host, else nothing. */
export function tabMentionSourceLabel(mention: TabMention): string {
  if (mention.title !== '') return mention.title
  try {
    return new URL(mention.url).hostname
  } catch {
    return ''
  }
}

/** What one key press means while the @标签页 picker is open. */
export type MentionPickerAction =
  | { type: 'none' }
  | { type: 'highlight'; index: number }
  | { type: 'pick'; index: number }
  | { type: 'dismiss' }

/**
 * Decide how the composer reacts to a key while the picker is open.
 *
 * Every branch is explicit so the caller never falls through: with the picker
 * open, Enter either picks a tab or dismisses the picker — it can never leak
 * into "send the message", which is what made the picker feel like a trap when
 * it was opened from the @ button and no tab was highlighted.
 *
 * Escape always dismisses, and IME composition is left to the input element.
 */
export function mentionPickerKeyAction(
  key: string,
  state: { highlight: number; optionCount: number; composing: boolean; shiftKey: boolean },
): MentionPickerAction {
  if (state.composing) return { type: 'none' }
  if (key === 'Escape') return { type: 'dismiss' }
  if (key === 'ArrowDown') {
    if (state.optionCount === 0) return { type: 'highlight', index: -1 }
    const from = state.highlight < 0 ? -1 : Math.min(state.highlight, state.optionCount - 1)
    return { type: 'highlight', index: Math.min(from + 1, state.optionCount - 1) }
  }
  if (key === 'ArrowUp') {
    if (state.optionCount === 0) return { type: 'highlight', index: -1 }
    return { type: 'highlight', index: Math.max(Math.min(state.highlight, state.optionCount - 1) - 1, 0) }
  }
  if (key === 'Enter' && !state.shiftKey) {
    if (state.optionCount === 0) return { type: 'dismiss' }
    const index = state.highlight < 0 ? 0 : Math.min(state.highlight, state.optionCount - 1)
    return { type: 'pick', index }
  }
  return { type: 'none' }
}
