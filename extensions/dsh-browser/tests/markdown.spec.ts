// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/panel/markdown.ts'

/** Visible text of a rendered fragment, so token spans do not break assertions. */
function textOf(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content.textContent ?? ''
}

describe('renderMarkdown', () => {
  it('renders common markdown constructs', () => {
    const html = renderMarkdown('# 标题\n\n**加粗** 和 `code`\n\n- 甲\n- 乙\n\n> 引用')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<li>甲</li>')
    expect(html).toContain('<blockquote>')
  })

  it('renders GFM tables and fenced code blocks', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1\n```')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('<pre><code')
    expect(textOf(html)).toContain('const x = 1')
  })

  it('colors a fenced block with the desktop shiki palette', () => {
    const html = renderMarkdown('```ts\nconst answer: number = 41 // note\n```')

    // Shiki's CSS-variables theme, wired to the panel's --shiki-* sheet.
    expect(html).toContain('var(--shiki-token-keyword)')
    expect(html).toContain('<span class="line">')
    expect(textOf(html)).toContain('const answer: number = 41 // note')
  })

  it('highlights the aliases users actually write', () => {
    const samples: Record<string, string> = {
      bash: 'echo "hi" # note',
      js: 'const value = "x"',
      json: '{"value": "x"}',
      python: 'value = "x"',
      sql: 'SELECT "x" FROM t',
      yml: 'value: "x"',
    }
    for (const [fence, code] of Object.entries(samples)) {
      const html = renderMarkdown(`\`\`\`${fence}\n${code}\n\`\`\``)
      expect(html, `${fence} should be highlighted`).toContain('var(--shiki-token-')
    }
  })

  it('leaves an unknown fence and inline code as plain text', () => {
    const unknown = renderMarkdown('```nosuchlang\nconst x = 1\n```')
    expect(unknown).not.toContain('var(--shiki-token-')
    expect(textOf(unknown)).toContain('const x = 1')

    const inline = renderMarkdown('内联 `const x = 1` 代码')
    expect(inline).not.toContain('var(--shiki-token-')
    expect(inline).toContain('<code>const x = 1</code>')
  })

  it('leaves a block too large to tokenize as plain text', () => {
    const html = renderMarkdown(`\`\`\`ts\n${'const value = 1\n'.repeat(2000)}\`\`\``)
    expect(html).not.toContain('var(--shiki-token-')
    expect(textOf(html)).toContain('const value = 1')
  })

  it('keeps only a fence language hint and strips model-authored classes', () => {
    const html = renderMarkdown('<code class="evil">x</code>\n\n```ts\nconst ok = 1\n```')

    expect(html).not.toContain('class="evil"')
    // The surviving class is the fence hint the highlighter consumed.
    expect(html).not.toContain('class="language-ts"')
    expect(html).not.toContain('<span class="evil"')
  })

  it('breaks single newlines into <br> (chat-style text)', () => {
    expect(renderMarkdown('第一行\n第二行')).toContain('<br>')
  })

  it('strips scripts and event handlers (XSS defense)', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)">\n\n**ok**')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).toContain('<strong>ok</strong>')
  })

  it('strips active and layout-altering raw HTML', () => {
    const html = renderMarkdown('<form action="https://evil.example"><button style="position:fixed;inset:0">伪装界面</button></form><img src="https://evil.example/leak">')
    expect(html).toContain('伪装界面')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('style=')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('evil.example')
  })

  it('opens http(s) links in a new tab and drops javascript: hrefs', () => {
    const html = renderMarkdown('[官网](https://deepseek.com) [坏链](javascript:alert(1)) [邮件](mailto:a@example.com) [相对路径](/panel)')
    expect(html).toContain('href="https://deepseek.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('mailto:')
    expect(html).not.toContain('href="/panel"')
  })

  it('handles empty and plain input', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('plain text')).toContain('plain text')
  })
})
