// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mentionPickerKeyAction } from '../src/panel/tab-mentions.ts'

const state = (
  highlight: number,
  optionCount: number,
  extra: Partial<{ composing: boolean; shiftKey: boolean }> = {},
) => ({ highlight, optionCount, composing: false, shiftKey: false, ...extra })

describe('@标签页 picker keyboard decisions', () => {
  it('picks the highlighted tab on Enter instead of sending the message', () => {
    expect(mentionPickerKeyAction('Enter', state(1, 3))).toEqual({ type: 'pick', index: 1 })
  })

  it('picks the first tab when nothing is highlighted yet', () => {
    expect(mentionPickerKeyAction('Enter', state(-1, 3))).toEqual({ type: 'pick', index: 0 })
  })

  it('dismisses rather than sending when there is no tab to pick', () => {
    expect(mentionPickerKeyAction('Enter', state(0, 0))).toEqual({ type: 'dismiss' })
    expect(mentionPickerKeyAction('Enter', state(-1, 0))).toEqual({ type: 'dismiss' })
  })

  it('never turns a key into "send" while the picker is open', () => {
    for (const key of ['Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'a']) {
      expect(mentionPickerKeyAction(key, state(0, 2)).type).not.toBe('send')
    }
  })

  it('closes on Escape from any highlight state', () => {
    expect(mentionPickerKeyAction('Escape', state(-1, 0))).toEqual({ type: 'dismiss' })
    expect(mentionPickerKeyAction('Escape', state(2, 3))).toEqual({ type: 'dismiss' })
  })

  it('moves the highlight with the arrow keys and stays in range', () => {
    expect(mentionPickerKeyAction('ArrowDown', state(-1, 3))).toEqual({ type: 'highlight', index: 0 })
    expect(mentionPickerKeyAction('ArrowDown', state(2, 3))).toEqual({ type: 'highlight', index: 2 })
    expect(mentionPickerKeyAction('ArrowDown', state(0, 0))).toEqual({ type: 'highlight', index: -1 })
    expect(mentionPickerKeyAction('ArrowUp', state(0, 3))).toEqual({ type: 'highlight', index: 0 })
    expect(mentionPickerKeyAction('ArrowUp', state(2, 3))).toEqual({ type: 'highlight', index: 1 })
  })

  it('leaves IME composition and shifted Enter to the input', () => {
    expect(mentionPickerKeyAction('Enter', state(0, 2, { composing: true }))).toEqual({ type: 'none' })
    expect(mentionPickerKeyAction('Enter', state(0, 2, { shiftKey: true }))).toEqual({ type: 'none' })
  })
})
