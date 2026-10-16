/**
 * Markdown → sanitized HTML for conversation bubbles.
 *
 * Model and user text is untrusted: the rendered output goes through
 * DOMPurify before touching the DOM, and http(s) links are forced to open in
 * a new tab (the side panel must never navigate away from the chat).
 *
 * @module
 */

import DOMPurify, { type Config } from 'dompurify'
import { marked } from 'marked'
import { highlightCodeHtml } from './highlight.ts'

const MARKDOWN_SANITIZE_OPTIONS = {
  ALLOWED_TAGS: [
    'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody',
    'td', 'th', 'thead', 'tr', 'ul',
  ],
  // `class` survives only so a fence's `language-x` hint reaches the
  // highlighter; every other class is dropped right below, and the spans that
  // carry the colors are authored here, never parsed out of model text.
  ALLOWED_ATTR: ['align', 'class', 'href', 'start', 'title'],
  ALLOWED_URI_REGEXP: /^https?:\/\//i,
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
} satisfies Config

/** The `language-x` hint marked puts on a fenced block's `<code>`. */
const LANGUAGE_CLASS = /^language-([\w+#.-]+)$/u

marked.setOptions({
  gfm: true,
  // 聊天式文本：单个换行渲染为 <br>（与 DeepSeek 聊天界面的换行行为一致）。
  breaks: true,
})

/**
 * Render markdown source to sanitized HTML safe for `innerHTML`.
 *
 * @param source - markdown text (may be empty)
 * @returns sanitized HTML fragment
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source ?? '', { async: false }) as string
  const template = document.createElement('template')
  template.innerHTML = DOMPurify.sanitize(html, MARKDOWN_SANITIZE_OPTIONS)
  // Only a well-formed `language-*` on a fenced block keeps a class; anything
  // else the model wrote is stripped so it cannot style itself.
  for (const element of template.content.querySelectorAll('[class]')) {
    const hint = element.tagName === 'CODE' ? LANGUAGE_CLASS.exec(element.className) : null
    if (hint === null) element.removeAttribute('class')
  }
  // Highlight the sanitized text, then swap in spans we authored: the code
  // block keeps its own `<pre>` so the panel styles still apply. The hint is
  // consumed here and never shipped, so no model-authored class reaches the DOM.
  for (const code of template.content.querySelectorAll('pre > code')) {
    const hint = LANGUAGE_CLASS.exec(code.className)
    code.removeAttribute('class')
    const highlighted = highlightCodeHtml(code.textContent ?? '', hint?.[1])
    if (highlighted !== null) code.innerHTML = highlighted
  }
  for (const link of template.content.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href)) {
      link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noreferrer noopener')
    }
  }
  return template.innerHTML
}
