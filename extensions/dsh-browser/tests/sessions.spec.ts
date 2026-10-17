// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  latestSessionTitle,
  projectedSessionTitle,
  resumableSessions,
  sessionAcceptsPrompts,
  sessionDisplayTitle,
  sessionPickerLabel,
  sessionTitleFromEvent,
  sessionWorkspaceLabel,
  SessionRuntimeCache,
  type SessionPickerEntry,
  type SessionPickerLabels,
} from '../src/panel/sessions.ts'

const ordinary: SessionPickerEntry = {
  sessionId: 'ordinary',
  updatedAt: 3,
  running: false,
  blank: false,
  cwd: '/workspace',
}

describe('resumableSessions', () => {
  it('keeps ordinary started sessions in host recency order', () => {
    const second = { ...ordinary, sessionId: 'second', updatedAt: 2 }
    expect(resumableSessions([ordinary, second])).toEqual([ordinary, second])
  })

  it('removes blank and subagent sessions that cannot be resumed normally', () => {
    expect(resumableSessions([
      { ...ordinary, sessionId: 'blank', blank: true },
      { ...ordinary, sessionId: 'subagent', origin: 'subagent' },
      ordinary,
    ])).toEqual([ordinary])
  })
})

const labels: SessionPickerLabels = {
  defaultWorkspace: '默认工作区',
  browserSessions: '浏览器',
  untitled: '未命名会话',
}

describe('sessionWorkspaceLabel', () => {
  it('names the default workspace and the extension group in the panel locale', () => {
    expect(sessionWorkspaceLabel('/Users/me/documents/default-workspace', labels)).toBe('默认工作区')
    expect(sessionWorkspaceLabel('/Users/me/.dsh/browser-sessions', labels)).toBe('浏览器')
  })

  it('uses the folder name for any other workspace, tolerating Windows paths', () => {
    expect(sessionWorkspaceLabel('/Users/me/codes/dsh/', labels)).toBe('dsh')
    expect(sessionWorkspaceLabel('C:\\work\\dsh-browser\\', labels)).toBe('dsh-browser')
  })

  it('has no label when the session has no working directory', () => {
    expect(sessionWorkspaceLabel(undefined, labels)).toBeUndefined()
    expect(sessionWorkspaceLabel('', labels)).toBeUndefined()
  })
})

describe('sessionPickerLabel', () => {
  it('prefixes the session title with its workspace', () => {
    expect(sessionPickerLabel({
      ...ordinary,
      cwd: '/Users/me/.dsh/browser-sessions',
      projections: { asOfSeq: 4, values: { title: '总结页面内容' } },
    }, labels)).toBe('浏览器-总结页面内容')

    expect(sessionPickerLabel({
      ...ordinary,
      cwd: '/Users/me/documents/default-workspace',
      projections: { asOfSeq: 4, values: { title: '查看磁盘空间占用并清理' } },
    }, labels)).toBe('默认工作区-查看磁盘空间占用并清理')
  })

  it('marks a session that never got a title instead of repeating its directory', () => {
    expect(sessionPickerLabel({
      ...ordinary,
      cwd: '/Users/me/.dsh/browser-sessions',
    }, labels)).toBe('浏览器-未命名会话')
  })

  it('shows the bare title when the session has no working directory', () => {
    expect(sessionPickerLabel({
      ...ordinary,
      cwd: undefined,
      projections: { asOfSeq: 4, values: { title: 'alone' } },
    }, labels)).toBe('alone')
  })
})

describe('sessionDisplayTitle', () => {
  it('uses the durable dsh title projection when present', () => {
    expect(sessionDisplayTitle({
      ...ordinary,
      projections: { asOfSeq: 4, values: { title: 'Review pull request feedback' } },
    })).toBe('Review pull request feedback')
  })

  it('falls back through the directory basename and session ID', () => {
    expect(sessionDisplayTitle({ ...ordinary, cwd: '/workspace/dsh-browser/' })).toBe('dsh-browser')
    expect(sessionDisplayTitle({ ...ordinary, cwd: 'C:\\work\\dsh-browser\\' })).toBe('dsh-browser')
    expect(sessionDisplayTitle({ ...ordinary, cwd: undefined })).toBe('ordinary')
  })

  it('ignores malformed or blank title projections', () => {
    expect(sessionDisplayTitle({
      ...ordinary,
      projections: { asOfSeq: 4, values: { title: '   ' } },
    })).toBe('workspace')
    expect(sessionDisplayTitle({
      ...ordinary,
      projections: { asOfSeq: 4, values: { title: { unsafe: true } } },
    })).toBe('workspace')
  })

  it('exposes only a valid durable projection as the current-session title', () => {
    expect(projectedSessionTitle({
      ...ordinary,
      projections: { asOfSeq: 4, values: { title: '  Browser session  ' } },
    })).toBe('Browser session')
    expect(projectedSessionTitle(ordinary)).toBeUndefined()
  })
})

describe('session title events', () => {
  it('tracks live title events and the newest valid history title', () => {
    const first = { type: 'session/title', data: { title: 'First title' } }
    const second = { type: 'session/title', data: { title: 'Second title' } }
    expect(sessionTitleFromEvent(second)).toBe('Second title')
    expect(sessionTitleFromEvent({ type: 'assistant/message', data: { title: 'Ignored' } })).toBeUndefined()
    expect(latestSessionTitle([first, second])).toBe('Second title')
  })

  it('ignores malformed title events during history replay', () => {
    expect(latestSessionTitle([
      { type: 'session/title', data: { title: 'Valid title' } },
      { type: 'session/title', data: { title: '   ' } },
      { type: 'session/title', data: { title: { unsafe: true } } },
    ])).toBe('Valid title')
  })
})

describe('SessionRuntimeCache', () => {
  it('restores off-session running and concurrent question state', () => {
    const cache = new SessionRuntimeCache()
    cache.startTurn('session')
    cache.rememberQuestion({ rpcId: 'q1', sessionId: 'session', questions: [{ id: '1', question: 'First?' }] })
    cache.rememberQuestion({ rpcId: 'q2', sessionId: 'session', questions: [{ id: '2', question: 'Second?' }] })
    expect(cache.snapshot('session')).toMatchObject({ running: true })
    expect(cache.snapshot('session').questions.map((question) => question.rpcId)).toEqual(['q1', 'q2'])
  })

  it('lets live status beat an older list baseline', () => {
    const cache = new SessionRuntimeCache()
    cache.finishTurn('session')
    cache.seedRunning('session', true)
    expect(cache.snapshot('session').running).toBe(false)
  })

  it('resolves one question and clears transient state at turn end', () => {
    const cache = new SessionRuntimeCache()
    cache.rememberQuestion({ rpcId: 'q1', sessionId: 'session', questions: [{ id: '1', question: 'First?' }] })
    cache.rememberQuestion({ rpcId: 'q2', sessionId: 'session', questions: [{ id: '2', question: 'Second?' }] })
    cache.resolveQuestion({ rpcId: 'q2', sessionId: 'session' })
    expect(cache.snapshot('session').questions.map((question) => question.rpcId)).toEqual(['q1'])
    cache.finishTurn('session')
    expect(cache.snapshot('session')).toEqual({ running: false, questions: [] })
  })
})

describe('sessionAcceptsPrompts', () => {
  it('requires a connected, settled session with a concrete ID', () => {
    expect(sessionAcceptsPrompts(true, false, 'session')).toBe(true)
    expect(sessionAcceptsPrompts(false, false, 'session')).toBe(false)
    expect(sessionAcceptsPrompts(true, true, 'old-session')).toBe(false)
    expect(sessionAcceptsPrompts(true, false, null)).toBe(false)
  })
})
