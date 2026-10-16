// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('panel layout styles', () => {
  it('keeps the settings view within the viewport so overflowing content scrolls', () => {
    const styles = readFileSync(`${process.cwd()}/src/panel/styles.css`, 'utf8')
    const settingsRule = styles.match(/\.settings\s*\{([^}]*)\}/)?.[1]

    expect(settingsRule).toBeDefined()
    expect(settingsRule).toMatch(/(?:^|\n)\s*height:\s*100vh;/)
    expect(settingsRule).toMatch(/(?:^|\n)\s*height:\s*100dvh;/)
    expect(settingsRule).toMatch(/(?:^|\n)\s*overflow-y:\s*auto;/)
    expect(settingsRule).toMatch(/(?:^|\n)\s*overscroll-behavior:\s*contain;/)
  })

  it('keeps settings sections at their natural height so the view can overflow', () => {
    const styles = readFileSync(`${process.cwd()}/src/panel/styles.css`, 'utf8')
    const settingsChildrenRule = styles.match(/\.settings\s*>\s*\*\s*\{([^}]*)\}/)?.[1]

    expect(settingsChildrenRule).toBeDefined()
    expect(settingsChildrenRule).toMatch(/(?:^|\n)\s*flex-shrink:\s*0;/)
  })

  it('places an upward model menu on its own row under the composer', () => {
    const styles = readFileSync(`${process.cwd()}/src/panel/styles.css`, 'utf8')
    const modelRule = styles.match(/\.composer-model\s*\{([^}]*)\}/)?.[1]
    const menuRule = styles.match(/\.composer-model-menu\s*\{([^}]*)\}/)?.[1]

    expect(modelRule).toBeDefined()
    expect(modelRule).toMatch(/(?:^|\n)\s*position:\s*relative;/)
    expect(modelRule).toMatch(/(?:^|\n)\s*margin-top:\s*8px;/)
    expect(menuRule).toBeDefined()
    expect(menuRule).toMatch(/(?:^|\n)\s*position:\s*absolute;/)
    expect(menuRule).toMatch(/(?:^|\n)\s*bottom:\s*calc\(100% \+ 6px\);/)
  })

  it('keeps inline code and light-filled chips readable in dark mode', () => {
    const styles = readFileSync(`${process.cwd()}/src/panel/styles.css`, 'utf8')
    const darkRule = (selector: string): string | undefined =>
      styles.match(new RegExp(`:root\\[data-theme='dark'\\] ${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1]

    // These base rules hardcode light fills, so each needs a dark override:
    // without one the dark theme's light ink lands on a light chip.
    for (const selector of ['.row .body.md code', '.question-index', '.composer-actions button:disabled']) {
      const rule = darkRule(selector)
      expect(rule, `${selector} needs a dark-mode override`).toBeDefined()
      expect(rule ?? '').toMatch(/(?:^|\n)\s*background:/)
    }

    // Inline code only: a fenced code block keeps its own dark fill, so the
    // dark override must reset the chip treatment back to transparent.
    expect(darkRule('.row .body.md pre code')).toMatch(/(?:^|\n)\s*background:\s*transparent;/)
  })

  it('lets the composer textarea grow instead of capping the visible draft', () => {
    const styles = readFileSync(`${process.cwd()}/src/panel/styles.css`, 'utf8')
    const textarea = styles.match(/\.composer textarea\s*\{([^}]*)\}/)?.[1]

    expect(textarea).toBeDefined()
    expect(textarea).toMatch(/(?:^|\n)\s*resize:\s*vertical;/)
    // The fixed 150px cap is what made a long draft unreadable.
    expect(textarea).not.toMatch(/(?:^|\n)\s*max-height:\s*150px;/)
    expect(textarea).toMatch(/(?:^|\n)\s*max-height:\s*min\(60vh, 480px\);/)
  })

  it('gives the @标签页 picker a close control of its own', () => {
    const styles = readFileSync(`${process.cwd()}/src/panel/styles.css`, 'utf8')
    const close = styles.match(/\.tab-mention-close\s*\{([^}]*)\}/)?.[1]

    expect(close).toBeDefined()
    expect(close).toMatch(/cursor:\s*pointer;/)
    expect(close).toMatch(/place-items:\s*center;/)
  })

  it('scales every local @标签页 font size through the scale token', () => {
    const styles = readFileSync(`${process.cwd()}/src/panel/styles.css`, 'utf8')
    const mentionBlock = styles.slice(styles.indexOf('/* @标签页 tab mentions'))

    expect(mentionBlock).not.toMatch(/font-size:\s*\d/)
  })

  it('renders the text-size control inside settings, not beside the title', () => {
    const app = readFileSync(`${process.cwd()}/src/panel/App.tsx`, 'utf8')
    const settingsStart = app.indexOf('className="settings"')
    const settingsEnd = app.indexOf('</div>{approvalDialog}</>')

    expect(settingsStart).toBeGreaterThan(-1)
    expect(settingsEnd).toBeGreaterThan(settingsStart)
    expect(app.slice(settingsStart, settingsEnd)).toMatch(/<TextSizeSetting/)
    // The title bar keeps only the new-session and settings buttons.
    expect(app).not.toMatch(/text-size-trigger/)
    expect(app).not.toMatch(/TextSizePanel/)
  })

  it('uses the desktop copy artwork instead of a text label', () => {
    const styles = readFileSync(`${process.cwd()}/src/panel/styles.css`, 'utf8')
    const button = styles.match(/\.message-copy\s*\{([^}]*)\}/)?.[1]
    const artwork = styles.match(/\.message-copy svg\s*\{([^}]*)\}/)?.[1]
    const app = readFileSync(`${process.cwd()}/src/panel/App.tsx`, 'utf8')

    expect(button).toBeDefined()
    expect(button).toMatch(/place-items:\s*center;/)
    expect(artwork).toBeDefined()
    expect(artwork).toMatch(/width:/)
    expect(app).toMatch(/<CopyIcon \/>/)
    expect(app).toMatch(/<CopiedIcon \/>/)
    // The label survives only as the accessible name, never as the button text.
    expect(app).not.toMatch(/\{copied \? copy\.app\.copied : copy\.app\.copyMessage\}\s*<\/button>/)
  })

  it('defines every shiki token the highlighted code blocks can reference', () => {
    const styles = readFileSync(`${process.cwd()}/src/panel/styles.css`, 'utf8')

    // A missing variable would silently fall back to shiki's own default color,
    // so the whole palette the CSS-variables theme can emit must be defined.
    for (const token of [
      '--shiki-foreground',
      '--shiki-background',
      '--shiki-token-constant',
      '--shiki-token-string',
      '--shiki-token-comment',
      '--shiki-token-keyword',
      '--shiki-token-parameter',
      '--shiki-token-function',
      '--shiki-token-string-expression',
      '--shiki-token-punctuation',
      '--shiki-token-link',
    ]) {
      expect(styles, `${token} must be defined`).toContain(`${token}:`)
    }

    // The dark theme keeps the card dark enough for that palette to stay legible.
    const darkBlock = styles.match(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(darkBlock).toMatch(/--code-block-bg:\s*#1b1b1c;/)
  })
})
