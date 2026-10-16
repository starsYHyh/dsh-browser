/**
 * Syntax highlighting for fenced code blocks.
 *
 * Deliberately mirrors the desktop app's highlighter: Shiki's core with the
 * JavaScript regex engine — no Oniguruma WASM, which the extension's MV3 CSP
 * (`script-src 'self'`) would reject — and Shiki's CSS-variables theme, so the
 * colors come from the same `--shiki-*` custom properties the desktop renders
 * with. The palette itself lives in `styles.css`.
 *
 * Grammars are bundled statically rather than lazily imported: highlighting
 * runs synchronously while a transcript row renders, so an awaited grammar
 * could not color the block it was asked about. A fence outside this set stays
 * plain text, and so does a block big enough that tokenizing it would stall the
 * panel.
 *
 * @module
 */

import langC from '@shikijs/langs/c'
import langCss from '@shikijs/langs/css'
import langDiff from '@shikijs/langs/diff'
import langGo from '@shikijs/langs/go'
import langHtml from '@shikijs/langs/html'
import langJava from '@shikijs/langs/java'
import langJavascript from '@shikijs/langs/javascript'
import langJson from '@shikijs/langs/json'
import langKotlin from '@shikijs/langs/kotlin'
import langPython from '@shikijs/langs/python'
import langRust from '@shikijs/langs/rust'
import langShell from '@shikijs/langs/shellscript'
import langSql from '@shikijs/langs/sql'
import langToml from '@shikijs/langs/toml'
import langTypescript from '@shikijs/langs/typescript'
import langXml from '@shikijs/langs/xml'
import langYaml from '@shikijs/langs/yaml'
import { createHighlighterCoreSync, createCssVariablesTheme, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

/** Shiki theme name; its token colors are the `--shiki-*` sheet in styles.css. */
const THEME = 'css-variables'

/** Blocks longer than this stay plain: tokenizing them would stall a row. */
export const MAX_HIGHLIGHT_CHARS = 20_000

const GRAMMARS = [
  langC,
  langCss,
  langDiff,
  langGo,
  langHtml,
  langJava,
  langJavascript,
  langJson,
  langKotlin,
  langPython,
  langRust,
  langShell,
  langSql,
  langToml,
  langTypescript,
  langXml,
  langYaml,
]

/**
 * Fence tags users actually write, mapped to a bundled grammar id.
 *
 * Shiki resolves its own aliases, but resolving here keeps the contract explicit
 * and lets several tags (`sh`, `zsh`, `console`) share one grammar.
 */
const FENCE_LANGUAGES: Record<string, string> = {
  bash: 'shellscript',
  c: 'c',
  console: 'shellscript',
  cpp: 'c',
  css: 'css',
  diff: 'diff',
  go: 'go',
  golang: 'go',
  h: 'c',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  kotlin: 'kotlin',
  mjs: 'javascript',
  patch: 'diff',
  py: 'python',
  python: 'python',
  rs: 'rust',
  rust: 'rust',
  sh: 'shellscript',
  shell: 'shellscript',
  sql: 'sql',
  svg: 'xml',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shellscript',
}

let highlighter: HighlighterCore | null = null
let highlighterUnavailable = false

/** The process-wide highlighter, built on first use and reused afterwards. */
function instance(): HighlighterCore | null {
  if (highlighterUnavailable) return null
  if (highlighter !== null) return highlighter
  try {
    highlighter = createHighlighterCoreSync({
      themes: [createCssVariablesTheme()],
      langs: GRAMMARS,
      engine: createJavaScriptRegexEngine(),
    })
  } catch (error) {
    // Never let a highlighter problem take the transcript down: every caller
    // falls back to the plain block.
    highlighterUnavailable = true
    console.warn('[dsh-browser] syntax highlighter unavailable:', error)
  }
  return highlighter
}

/** The bundled grammar id for a fence tag, or undefined when we do not ship it. */
export function languageForFenceTag(fenceTag: string | undefined): string | undefined {
  if (fenceTag === undefined) return undefined
  return FENCE_LANGUAGES[fenceTag.trim().toLowerCase()]
}

/**
 * Compile the grammars ahead of the first code block.
 *
 * Building the highlighter is the expensive part (it compiles every grammar into
 * regexes), so the panel calls this while idle instead of paying for it inside
 * the render of the first fenced block.
 */
export function warmUpHighlighter(): void {
  instance()
}

/**
 * Highlight one fenced block.
 *
 * @param code - the block's raw text
 * @param fenceTag - the info string after the opening fence (`js`, `bash`, …)
 * @returns the highlighted inner HTML for `<code>`, or null to keep plain text
 */
export function highlightCodeHtml(code: string, fenceTag: string | undefined): string | null {
  if (code.length > MAX_HIGHLIGHT_CHARS) return null
  const language = languageForFenceTag(fenceTag)
  if (language === undefined) return null
  const core = instance()
  if (core === null) return null
  try {
    const template = document.createElement('template')
    template.innerHTML = core.codeToHtml(code, { lang: language, theme: THEME })
    return template.content.querySelector('code')?.innerHTML ?? null
  } catch (error) {
    console.warn(`[dsh-browser] could not highlight ${language}:`, error)
    return null
  }
}
