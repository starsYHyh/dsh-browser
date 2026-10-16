/**
 * Markdown → sanitized HTML for conversation bubbles.
 *
 * Model and user text is untrusted: the rendered output goes through
 * DOMPurify before touching the DOM, and http(s) links are forced to open in
 * a new tab (the side panel must never navigate away from the chat).
 *
 * Code blocks then gain the chrome the desktop app gives them: a header holding
 * the fence's language label and a copy button. Both are authored here, after
 * sanitizing, so nothing in the model's text can forge or restyle them.
 *
 * @module
 */

import DOMPurify, { type Config } from 'dompurify'
import { marked } from 'marked'
import { highlightCodeHtml } from './highlight.ts'
import { COPY_ICON_SVG } from './icons.ts'

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

/** Accessible name of a code block's copy button, per panel locale. */
export interface CodeBlockLabels {
  copy: string
}

const DEFAULT_CODE_LABELS: CodeBlockLabels = { copy: 'Copy' }

marked.setOptions({
  gfm: true,
  // 聊天式文本：单个换行渲染为 <br>（与 DeepSeek 聊天界面的换行行为一致）。
  breaks: true,
})

/**
 * Wrap one `<pre>` in the desktop's code-card chrome.
 *
 * @param pre - the sanitized code block
 * @param label - fence language shown at the top-left (`ts`, `bash`, …)
 * @param labels - copy button copy for the panel's locale
 */
function decorateCodeBlock(pre: Element, label: string | undefined, labels: CodeBlockLabels): void {
  const doc = pre.ownerDocument
  const wrapper = doc.createElement('div')
  wrapper.className = 'code-block'
  const head = doc.createElement('div')
  head.className = 'code-block-head'
  // The label is always rendered, even when empty, so the copy button stays in
  // the same place whether or not the fence named a language.
  const language = doc.createElement('span')
  language.className = 'code-block-lang'
  language.textContent = label ?? ''
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'code-block-copy'
  button.setAttribute('data-code-copy', '')
  button.setAttribute('aria-label', labels.copy)
  button.setAttribute('title', labels.copy)
  button.innerHTML = COPY_ICON_SVG
  head.append(language, button)
  pre.replaceWith(wrapper)
  wrapper.append(head, pre)
}

/**
 * Render markdown source to sanitized HTML safe for `innerHTML`.
 *
 * @param source - markdown text (may be empty)
 * @param labels - code-block copy for the panel's locale
 * @returns sanitized HTML fragment
 */
export function renderMarkdown(source: string, labels: CodeBlockLabels = DEFAULT_CODE_LABELS): string {
  const html = marked.parse(source ?? '', { async: false }) as string
  const template = document.createElement('template')
  template.innerHTML = DOMPurify.sanitize(html, MARKDOWN_SANITIZE_OPTIONS)
  // Only a well-formed `language-*` on a fenced block keeps a class; anything
  // else the model wrote is stripped so it cannot style itself.
  for (const element of template.content.querySelectorAll('[class]')) {
    const hint = element.tagName === 'CODE' ? LANGUAGE_CLASS.exec(element.className) : null
    if (hint === null) element.removeAttribute('class')
  }
  // Highlight the sanitized text, then swap in spans we authored, then give the
  // block its header. The language hint is read first and never shipped, so no
  // model-authored class reaches the DOM.
  for (const pre of template.content.querySelectorAll('pre')) {
    const code = pre.querySelector('code')
    const hint = code === null ? null : LANGUAGE_CLASS.exec(code.className)
    if (code !== null) {
      code.removeAttribute('class')
      const highlighted = highlightCodeHtml(code.textContent ?? '', hint?.[1])
      if (highlighted !== null) code.innerHTML = highlighted
    }
    decorateCodeBlock(pre, hint?.[1], labels)
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
