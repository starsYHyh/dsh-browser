// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isNearScrollBottom, restoreConversationScroll } from '../src/panel/scroll.ts'

describe('isNearScrollBottom', () => {
  it('treats a fully scrolled viewport as near the bottom', () => {
    expect(isNearScrollBottom({ scrollTop: 200, scrollHeight: 500, clientHeight: 300 })).toBe(true)
  })

  it('allows a small slack threshold above the true bottom', () => {
    expect(isNearScrollBottom({ scrollTop: 160, scrollHeight: 500, clientHeight: 300 }, 48)).toBe(true)
    expect(isNearScrollBottom({ scrollTop: 140, scrollHeight: 500, clientHeight: 300 }, 48)).toBe(false)
  })

  it('treats short unscrollable content as near the bottom', () => {
    expect(isNearScrollBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 })).toBe(true)
  })
})

describe('restoreConversationScroll', () => {
  const element = (): { scrollTop: number; scrollHeight: number } => ({ scrollTop: 0, scrollHeight: 900 })

  it('returns a follower to the newest row after the pane remounted', () => {
    const view = element()
    restoreConversationScroll(view, { atBottom: true, offset: 120 })
    expect(view.scrollTop).toBe(900)
  })

  it('returns a reader to the offset they had scrolled to', () => {
    const view = element()
    restoreConversationScroll(view, { atBottom: false, offset: 320 })
    expect(view.scrollTop).toBe(320)
  })

  it('leaves a reader at the top when that is where they were', () => {
    const view = element()
    restoreConversationScroll(view, { atBottom: false, offset: 0 })
    expect(view.scrollTop).toBe(0)
  })
})

describe('conversation scroll restoration wiring', () => {
  it('remembers the offset while scrolling and restores it when the pane returns', () => {
    const app = readFileSync(`${process.cwd()}/src/panel/App.tsx`, 'utf8')

    // Recorded on every scroll event, so the value survives the pane unmounting.
    expect(app).toMatch(/scrollOffsetRef\.current = element\.scrollTop/)
    // Restored in a layout effect keyed on the settings view, before paint.
    expect(app).toMatch(/restoreConversationScroll\(element, \{ atBottom: atBottomRef\.current, offset: scrollOffsetRef\.current \}\)/)
    expect(app).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(showSettings\) return/)
  })
})
