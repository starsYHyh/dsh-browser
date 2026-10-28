// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  appendLiveRow,
  appendToolCall,
  completeLastTool,
  formatToolArgs,
  mergeHistoryRows,
  oldestEventSeq,
  prependHistoryRows,
  pendingQuestionFromFrame,
  resolvedQuestionFromFrame,
  rowFromEvent,
  textFromBlocks,
  toolResultOf,
  toolSummary,
  type Row,
  type SessionEventView,
} from '../src/panel/events.ts'

/** 构造符合真实 SessionEvent 形状（{ type, seq, time, data }）的事件。 */
function ev(type: string, data: Record<string, unknown>): SessionEventView {
  return { type, data }
}

describe('textFromBlocks', () => {
  it('extracts text blocks and ignores non-text', () => {
    expect(textFromBlocks([{ type: 'text', text: '你好' }, { type: 'reasoning', text: '思考' }])).toBe('你好')
    expect(textFromBlocks(undefined)).toBe('')
    expect(textFromBlocks([{ type: 'text' }])).toBe('')
  })
})

describe('rowFromEvent', () => {
  it('renders user messages from data.content (the real SessionEvent shape)', () => {
    const row = rowFromEvent(ev('user/message', { content: [{ type: 'text', text: '帮我看看页面' }], source: { kind: 'user' } }))
    expect(row).toEqual({ seq: 0, kind: 'user', text: '帮我看看页面' })
  })

  it('skips system-injected user/message events (source.kind = plugin)', () => {
    // dsh 每轮注入的运行时上下文（<system-reminder> 等）是 plugin 来源，
    // 绝不能渲染成用户消息。
    const injected = ev('user/message', {
      content: [{ type: 'text', text: '</system-reminder> 一段很长的系统注入…' }],
      source: { kind: 'plugin', plugin: 'workspace-context' },
    })
    expect(rowFromEvent(injected)).toBeNull()
  })

  it('renders assistant messages from data.message.content', () => {
    const row = rowFromEvent(ev('assistant/message', { message: { content: [{ type: 'text', text: '好的' }] } }))
    expect(row).toEqual({ seq: 0, kind: 'assistant', text: '好的' })
  })

  it('renders image-only and mixed multimodal messages from durable attachment refs', () => {
    const image = {
      type: 'image',
      attachment: {
        attachmentId: 'image-1', mediaType: 'image/png', bytes: 10, width: 20, height: 30, name: 'page.png',
      },
    }
    expect(rowFromEvent(ev('user/message', { content: [image], source: { kind: 'user' } }))).toEqual({
      seq: 0,
      kind: 'user',
      text: '',
      images: [image.attachment],
    })
    expect(rowFromEvent(ev('assistant/message', {
      message: { content: [{ type: 'text', text: 'I see it' }, image] },
    }))).toEqual({
      seq: 0,
      kind: 'assistant',
      text: 'I see it',
      images: [image.attachment],
    })
  })

  it('skips assistant events that contain only tool or blank blocks', () => {
    expect(rowFromEvent(ev('assistant/message', {
      message: { content: [{ type: 'tool_use', name: 'browser_snapshot' }] },
    }))).toBeNull()
    expect(rowFromEvent(ev('assistant/message', {
      message: { content: [{ type: 'text', text: '   \n' }] },
    }))).toBeNull()
  })

  it('returns null for non-message events', () => {
    expect(rowFromEvent(ev('turn/start', {}))).toBeNull()
    expect(rowFromEvent(ev('tool/call', { name: 'browser_click' }))).toBeNull()
  })
})

describe('toolSummary', () => {
  it('appends the inventory index when present', () => {
    expect(toolSummary('browser_click', '{"index":7}', 'zh')).toBe('点击元素 #7')
    expect(toolSummary('browser_snapshot', '{"delta":true}', 'zh')).toBe('读取页面')
    expect(toolSummary('browser_navigate', 'not-json', 'zh')).toBe('打开页面')
    expect(toolSummary('browser_open_tab', '{"url":"https://example.com"}', 'zh')).toBe('打开新标签页')
    expect(toolSummary('browser_list_tabs', '{}', 'zh')).toBe('列出标签页')
    expect(toolSummary('browser_follow_tab', '{"tabId":17}', 'zh')).toBe('跟随标签页')
    expect(toolSummary('browser_close_tab', '{"tabId":18}', 'zh')).toBe('关闭标签页')
    expect(toolSummary('custom_tool', '{}', 'zh')).toBe('custom_tool')
    expect(toolSummary('browser_click', '{"index":7}', 'en')).toBe('Click element #7')
    expect(toolSummary('browser_open_tab', '{"url":"https://example.com"}', 'en')).toBe('Open new tab')
    expect(toolSummary('browser_list_tabs', '{}', 'en')).toBe('List open tabs')
    expect(toolSummary('browser_follow_tab', '{"tabId":17}', 'en')).toBe('Follow tab')
    expect(toolSummary('browser_close_tab', '{"tabId":18}', 'en')).toBe('Close tab')
  })
})

describe('appendLiveRow / completeLastTool', () => {
  it('groups consecutive tool calls into one card (no tool spam)', () => {
    let rows: ReturnType<typeof appendLiveRow> = []
    rows = appendLiveRow(rows, 'user', '帮我操作页面', 1)
    rows = appendLiveRow(rows, 'tool', '读取页面', 2)
    rows = appendLiveRow(rows, 'tool', '点击元素 #7', 3)
    rows = appendLiveRow(rows, 'tool', '填写内容 #9', 4)
    rows = completeLastTool(rows, 5)
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tool'])
    expect(rows[1]).toMatchObject({ text: '读取页面 → 点击元素 #7 → 填写内容 #9', status: 'complete' })
    expect(rows[1]!.tools?.map((item) => item.summary)).toEqual(['读取页面', '点击元素 #7', '填写内容 #9'])
    rows = appendLiveRow(rows, 'assistant', '完成', 6)
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tool', 'assistant'])
  })

  it('keeps the card id stable while the group grows and completes', () => {
    let rows: Row[] = []
    rows = appendToolCall(rows, { name: 'browser_snapshot', summary: '读取页面', status: 'running', args: '{}' }, 1)
    const cardId = rows[0]!.id
    rows = appendToolCall(rows, { name: 'browser_click', summary: '点击元素 #7', status: 'running', args: '{"index":7}' }, 2)
    rows = completeLastTool(rows, 3)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(cardId)
    expect(rows[0]!.tools?.map((item) => item.status)).toEqual(['running', 'complete'])
    // 只有刚完成的那一条被结算，且原始参数留着给单条展开用。
    expect(rows[0]!.tools?.[1]).toMatchObject({ status: 'complete', args: '{"index":7}' })
    expect(rows[0]).toMatchObject({ text: '读取页面 → 点击元素 #7', status: 'complete' })
  })
})

describe('history paging', () => {
  it('reports the oldest durable seq of a page', () => {
    expect(oldestEventSeq([])).toBeNull()
    expect(oldestEventSeq([{ type: 'turn/start' }, { type: 'user/message', seq: 7 }])).toBe(7)
  })

  it('prepends older rows and rejoins a tool run cut by the page boundary', () => {
    let seq = 0
    const nextSeq = (): number => { seq += 1; return seq }
    const currentRows = mergeHistoryRows([
      ev('tool/call', { name: 'browser_click', arguments: '{"index":7}' }),
      ev('tool/result', {}),
      ev('assistant/message', { message: { content: [{ type: 'text', text: '完成' }] } }),
    ], nextSeq, 'zh')
    const rows = prependHistoryRows(currentRows, [
      ev('user/message', { content: [{ type: 'text', text: '第一问' }], source: { kind: 'user' } }),
      ev('tool/call', { name: 'browser_snapshot', arguments: '{}' }),
      ev('tool/result', {}),
    ], nextSeq, 'zh')
    expect(rows.map((row) => row.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(rows[1]!.tools?.map((item) => item.summary)).toEqual(['读取页面', '点击元素 #7'])
    expect(rows[1]!.text).toBe('读取页面 → 点击元素 #7')
  })

  it('leaves the current rows alone when the page renders nothing', () => {
    const current: Row[] = [{ seq: 1, id: 1, kind: 'info', text: '提示' }]
    expect(prependHistoryRows(current, [ev('turn/start', {})], () => 2, 'zh')).toBe(current)
  })
})

describe('formatToolArgs', () => {
  it('pretty-prints call arguments and hides empty payloads', () => {
    expect(formatToolArgs('{"index":7}')).toBe('{\n  "index": 7\n}')
    expect(formatToolArgs('{}')).toBeNull()
    expect(formatToolArgs('')).toBeNull()
    expect(formatToolArgs(undefined)).toBeNull()
    // 非法 JSON 原样给出，不吞掉模型看到的内容。
    expect(formatToolArgs('not json')).toBe('not json')
  })
})

describe('tool results', () => {
  it('reads the output text and error flag from a tool/result event', () => {
    expect(toolResultOf(ev('tool/result', {
      message: { content: [{ type: 'text', text: 'ok\n' }], isError: false },
    }))).toEqual({ output: 'ok' })
    expect(toolResultOf(ev('tool/result', {
      message: { content: [{ type: 'text', text: 'boom' }], isError: true },
    }))).toEqual({ output: 'boom', failed: true })
    expect(toolResultOf(ev('tool/result', { message: { content: [] } }))).toEqual({})
  })

  it('attaches the result to the completed call in history', () => {
    let seq = 0
    const rows = mergeHistoryRows([
      ev('tool/call', { name: 'bash', arguments: '{"description":"List files","command":"ls"}' }),
      ev('tool/result', { message: { content: [{ type: 'text', text: 'a.txt' }] } }),
    ], () => { seq += 1; return seq }, 'zh')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tools?.[0]).toMatchObject({
      summary: 'List files',
      status: 'complete',
      output: 'a.txt',
    })
  })

  it('completes the running call with its own output', () => {
    let rows: Row[] = []
    rows = appendToolCall(rows, { name: 'bash', summary: '运行命令', status: 'running', args: '{}' }, 1)
    rows = completeLastTool(rows, 2, { output: 'done', failed: false })
    expect(rows[0]!.tools?.[0]).toMatchObject({ status: 'complete', output: 'done' })
  })

  it('prefers a human description over the bare tool name', () => {
    expect(toolSummary('bash', '{"description":"Fetch page HTML","command":"curl x"}', 'zh')).toBe('Fetch page HTML')
    expect(toolSummary('bash', '{"command":"ls"}', 'zh')).toBe('运行命令')
    expect(toolSummary('bash', '{"command":"ls"}', 'en')).toBe('Run command')
  })
})

describe('mergeHistoryRows', () => {
  it('aggregates tool calls and renders user/assistant text from data', () => {
    let seq = 0
    const nextSeq = (): number => { seq += 1; return seq }
    const events = [
      ev('user/message', { content: [{ type: 'text', text: '操作页面' }], source: { kind: 'user' } }),
      ev('turn/start', {}),
      ev('tool/call', { name: 'browser_snapshot', arguments: '{}' }),
      ev('tool/result', {}),
      ev('tool/call', { name: 'browser_click', arguments: '{"index":7}' }),
      ev('tool/result', {}),
      ev('tool/call', { name: 'browser_click', arguments: '{"index":8}' }),
      ev('tool/result', {}),
      ev('assistant/message', { message: { content: [{ type: 'text', text: '已点击' }] } }),
      ev('turn/end', {}),
    ]
    const rows = mergeHistoryRows(events, nextSeq, 'zh')
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(rows[0]!.text).toBe('操作页面')
    expect(rows[2]!.text).toBe('已点击')
    // 一次运行归并成一张卡片（不逐条刷屏），组内逐条保留。
    expect(rows[1]).toMatchObject({ text: '读取页面 → 点击元素 #7 → 点击元素 #8', status: 'complete' })
    expect(rows[1]!.tools?.map((item) => item.summary)).toEqual(['读取页面', '点击元素 #7', '点击元素 #8'])
    expect(rows[1]!.tools?.map((item) => item.status)).toEqual(['complete', 'complete', 'complete'])
  })

  it('keeps one card across the bookkeeping events between two calls', () => {
    let seq = 0
    const nextSeq = (): number => { seq += 1; return seq }
    const rows = mergeHistoryRows([
      ev('user/message', { content: [{ type: 'text', text: '操作页面' }], source: { kind: 'user' } }),
      ev('assistant/message', { message: { content: [{ type: 'tool_use', name: 'browser_snapshot' }] } }),
      ev('tool/call', { name: 'browser_snapshot', arguments: '{}' }),
      ev('tool/result', {}),
      // 真实日志里 step/end → step/start → 记账事件夹在两次调用之间。
      ev('step/end', {}),
      ev('step/start', {}),
      ev('session-log-deepseek/delivery-accepted', {}),
      ev('tool/call', { name: 'browser_click', arguments: '{"index":7}' }),
      ev('tool/result', {}),
      ev('assistant/message', { message: { content: [{ type: 'text', text: '已点击' }] } }),
    ], nextSeq, 'zh')
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(rows[1]!.tools?.map((item) => item.summary)).toEqual(['读取页面', '点击元素 #7'])
    expect(rows[1]!.text).toBe('读取页面 → 点击元素 #7')
  })

  it('does not restore empty assistant rows from history', () => {
    let seq = 0
    const rows = mergeHistoryRows([
      ev('assistant/message', { message: { content: [{ type: 'tool_use', name: 'browser_snapshot' }] } }),
      ev('tool/call', { name: 'browser_snapshot', arguments: '{}' }),
      ev('tool/result', {}),
    ], () => { seq += 1; return seq }, 'zh')
    expect(rows).toEqual([{
      seq: 1,
      id: 1,
      kind: 'tool',
      text: '读取页面',
      tools: [{ name: 'browser_snapshot', summary: '读取页面', status: 'complete', args: '{}' }],
      status: 'complete',
    }])
  })

  it('handles empty history', () => {
    expect(mergeHistoryRows([], () => 0)).toEqual([])
  })
})

describe('question mux frames', () => {
  it('parses the full question, compact header, options, and session identity', () => {
    expect(pendingQuestionFromFrame({
      rpcId: 'question-rpc',
      method: 'question/requested',
      payload: {
        sessionId: 'session-1',
        questions: [{
          id: 'database',
          header: 'Database',
          question: 'Which database should we use?',
          detail: 'Choose the default for local development.',
          options: [{ label: 'SQLite', description: 'No setup required' }, { label: 'Postgres' }],
          multiSelect: false,
        }],
      },
    })).toEqual({
      rpcId: 'question-rpc',
      sessionId: 'session-1',
      questions: [{
        id: 'database',
        header: 'Database',
        question: 'Which database should we use?',
        detail: 'Choose the default for local development.',
        options: [{ label: 'SQLite', description: 'No setup required' }, { label: 'Postgres' }],
        multiSelect: false,
      }],
    })
  })

  it('rejects malformed question payloads instead of trusting mux data', () => {
    expect(pendingQuestionFromFrame({ rpcId: 'r', method: 'session/event', payload: {} })).toBeNull()
    expect(pendingQuestionFromFrame({ rpcId: 'r', method: 'question/requested', payload: null })).toBeNull()
    expect(pendingQuestionFromFrame({ rpcId: 'r', method: 'question/requested', payload: { sessionId: 5, questions: [] } })).toBeNull()
    expect(pendingQuestionFromFrame({
      rpcId: 'r', method: 'question/requested',
      payload: { sessionId: 's', questions: [{ id: 'q', question: 'Question?', options: [{ label: 4 }] }] },
    })).toBeNull()
  })

  it('accepts wire-valid empty strings and repeated question ids', () => {
    expect(pendingQuestionFromFrame({
      rpcId: '', method: 'question/requested',
      payload: {
        sessionId: 's',
        questions: [
          { id: '', question: '', options: [{ label: '' }] },
          { id: '', question: 'Repeated id' },
        ],
      },
    })).toEqual({
      rpcId: '',
      sessionId: 's',
      questions: [
        { id: '', question: '', options: [{ label: '' }] },
        { id: '', question: 'Repeated id' },
      ],
    })
  })

  it('extracts both identifiers required to match question/resolved', () => {
    expect(resolvedQuestionFromFrame({
      rpcId: 'event-rpc',
      method: 'question/resolved',
      payload: { sessionId: 'session-1', questionRpcId: 'question-rpc' },
    })).toEqual({ sessionId: 'session-1', rpcId: 'question-rpc' })
    expect(resolvedQuestionFromFrame({
      rpcId: 'event-rpc', method: 'question/resolved', payload: { sessionId: 'session-1' },
    })).toBeNull()
  })
})
