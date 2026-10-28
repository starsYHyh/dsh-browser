/**
 * Pure conversation-rendering logic: maps session events (live and history)
 * to display rows. Kept framework-free so the wire shapes are unit-tested
 * against the REAL SessionEvent contract: `{ type, seq, time, data }` — the
 * payload always lives in `data`, never on the event root.
 *
 * @module
 */

import { getUiLocale, type UiLocale } from '../i18n.ts'
import { imageRefsFromBlocks, type ImageAttachmentRef } from './attachments.ts'
import { PANEL_COPY } from './strings.ts'

/** One tool invocation inside a tool-activity group. */
export interface ToolCallItem {
  /** Raw tool name (`browser_click`), kept for aria labels. */
  name: string
  /** Localized one-line label, e.g. 「点击元素 #7」. */
  summary: string
  status: 'running' | 'complete'
  /** Raw JSON arguments, kept so one call can expand into its own input. */
  args?: string
  /** Tool result text (already capped by {@link toolResultOf}). */
  output?: string
  /** The tool reported an error. */
  failed?: boolean
}

/** One rendered conversation row. */
export interface Row {
  seq: number
  /**
   * Identity that survives live updates: `seq` is re-stamped every time a tool
   * group grows, and a changed React key would remount the card and drop the
   * collapsed state the user chose.
   */
  id?: number
  kind: 'user' | 'assistant' | 'tool' | 'info'
  text: string
  /** Tool calls of one run, in order (tool rows only). */
  tools?: ToolCallItem[]
  images?: ImageAttachmentRef[]
  status?: 'running' | 'complete'
  /** Event time in epoch milliseconds, when the source event carried one. */
  at?: number
}

/** Minimal view of a SessionEvent (payload in `data`). */
export interface SessionEventView {
  type: string
  seq?: number
  /** Session event time (epoch milliseconds). */
  time?: number
  surfaceOp?: unknown
  data?: {
    content?: unknown
    source?: { kind?: string }
    message?: { content?: unknown; source?: { kind?: string }; isError?: unknown }
    isError?: unknown
    turn?: number
    step?: number
    name?: string
    arguments?: string
    title?: unknown
  }
}

/** One user-selectable answer exposed by ask_user_question. */
export interface QuestionOption {
  label: string
  description?: string
}

/** One item in a question batch. */
export interface QuestionItem {
  id: string
  question: string
  header?: string
  detail?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

/** Pending interaction belonging to one dsh session. */
export interface PendingQuestion {
  rpcId: string
  sessionId: string
  questions: QuestionItem[]
}

/** Identity carried by question/resolved; both fields must match before clearing UI. */
export interface ResolvedQuestion {
  rpcId: string
  sessionId: string
}

/** The gateway mux envelope shape carried inside a bridge event frame. */
export interface EventFrameView {
  rpcId: string
  method: string
  payload: unknown
}

export function pendingQuestionFromFrame(frame: EventFrameView): PendingQuestion | null {
  if (typeof frame.rpcId !== 'string' || frame.method !== 'question/requested' || !isRecord(frame.payload)) return null
  const sessionId = frame.payload.sessionId
  const rawQuestions = frame.payload.questions
  if (typeof sessionId !== 'string' || !Array.isArray(rawQuestions) || rawQuestions.length === 0) return null
  const questions: QuestionItem[] = []
  for (const value of rawQuestions) {
    const question = parseQuestionItem(value)
    if (question === null) return null
    questions.push(question)
  }
  return { rpcId: frame.rpcId, sessionId, questions }
}

export function resolvedQuestionFromFrame(frame: EventFrameView): ResolvedQuestion | null {
  if (frame.method !== 'question/resolved' || !isRecord(frame.payload)) return null
  const sessionId = frame.payload.sessionId
  const rpcId = frame.payload.questionRpcId
  return typeof sessionId === 'string' && typeof rpcId === 'string' ? { sessionId, rpcId } : null
}

function parseQuestionItem(value: unknown): QuestionItem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.question !== 'string') return null
  if (value.header !== undefined && typeof value.header !== 'string') return null
  if (value.detail !== undefined && typeof value.detail !== 'string') return null
  if (value.multiSelect !== undefined && typeof value.multiSelect !== 'boolean') return null
  let options: QuestionOption[] | undefined
  if (value.options !== undefined) {
    if (!Array.isArray(value.options)) return null
    options = []
    for (const rawOption of value.options) {
      if (!isRecord(rawOption) || typeof rawOption.label !== 'string') return null
      if (rawOption.description !== undefined && typeof rawOption.description !== 'string') return null
      options.push({
        label: rawOption.label,
        ...(rawOption.description === undefined ? {} : { description: rawOption.description }),
      })
    }
  }
  return {
    id: value.id,
    question: value.question,
    ...(value.header === undefined ? {} : { header: value.header }),
    ...(value.detail === undefined ? {} : { detail: value.detail }),
    ...(options === undefined ? {} : { options }),
    ...(value.multiSelect === undefined ? {} : { multiSelect: value.multiSelect }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Extract model-visible text from content blocks (defensive: unknown block shapes degrade to markers). */
export function textFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return String(blocks ?? '')
  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as { type?: string; text?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('\n')
}

/** Map one session event to a row (user/assistant only; tools handled separately). */
export function rowFromEvent(event: SessionEventView): Row | null {
  switch (event.type) {
    case 'user/message': {
      // dsh 每轮把运行时常量上下文作为 source.kind='plugin' 的 user/message
      // 记入日志（如 <system-reminder> 注入内容）——它们不是用户消息，
      // 渲染会污染对话流，必须跳过。
      const message = event.data?.message ?? event.data
      const source = message?.source
      if (source?.kind !== 'user') return null
      const blocks = message?.content
      const text = textFromBlocks(blocks)
      const images = imageRefsFromBlocks(blocks)
      return text.trim() === '' && images.length === 0
        ? null
        : { seq: 0, kind: 'user', text, ...(images.length === 0 ? {} : { images }), ...(event.time === undefined ? {} : { at: event.time }) }
    }
    case 'assistant/message': {
      // 工具调用也会产生 assistant/message，但其 content 可能只有 tool_use
      // 等非文本块。不要为这种中间事件渲染一个空的 AI 气泡。
      const blocks = event.data?.message?.content
      const text = textFromBlocks(blocks)
      const images = imageRefsFromBlocks(blocks)
      return text.trim() === '' && images.length === 0
        ? null
        : { seq: 0, kind: 'assistant', text, ...(images.length === 0 ? {} : { images }), ...(event.time === undefined ? {} : { at: event.time }) }
    }
    default:
      return null
  }
}

/** 工具调用的友好展示名：带 index 参数时附上（如「点击元素 #7」）。 */
export function toolSummary(name: string, argsJson: unknown, locale: UiLocale = getUiLocale()): string {
  let summary = PANEL_COPY[locale].tool.labels[name] ?? name
  try {
    const args = JSON.parse(String(argsJson ?? '{}')) as unknown
    if (typeof args === 'object' && args !== null) {
      // 模型给工具写的一句说明（bash 的 description、自定义工具的 description）
      // 比工具名有用得多：优先展示它。
      const description = (args as { description?: unknown }).description
      if (typeof description === 'string' && description.trim() !== '') {
        summary = truncateSummary(description.trim())
      }
      else if ('index' in args) {
        summary += ` #${String((args as { index?: unknown }).index)}`
      }
    }
  } catch {
    // 模型参数不可解析：只显示工具名。
  }
  return summary
}

/** 头部摘要只留一行，过长的说明截断（完整内容在看详情里）。 */
function truncateSummary(text: string): string {
  const MAX_SUMMARY_CHARS = 90
  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS)}…` : text
}

/** 一次工具运行的折叠摘要：「A → B → C」。 */
function toolLine(items: readonly ToolCallItem[]): string {
  return items.map((item) => item.summary).join(' → ')
}

/**
 * 把一条调用的原始参数渲染成可展开的详情；没有值得展示的内容时返回 null
 * （空对象、空串），非法 JSON 原样给出。
 */
export function formatToolArgs(args: string | undefined): string | null {
  if (args === undefined) return null
  const raw = args.trim()
  if (raw === '' || raw === '{}' || raw === 'null') return null
  let pretty = raw
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // 参数不是合法 JSON：原样展示，模型和用户仍然能看懂。
  }
  const MAX_DETAIL_CHARS = 4000
  return pretty.length > MAX_DETAIL_CHARS ? `${pretty.slice(0, MAX_DETAIL_CHARS)}…` : pretty
}

/** 一次工具调用的输出：文本原样，超长截断成可滚动的一块。 */
export function formatToolOutput(output: string | undefined): string | null {
  if (output === undefined) return null
  const trimmed = output.trim()
  return trimmed === '' ? null : trimmed
}

/** 从 tool/result 事件里取出可展示的输出文本与错误标记。 */
export function toolResultOf(event: SessionEventView): { output?: string; failed?: boolean } {
  const message = event.data?.message
  const text = textFromBlocks(message?.content).trim()
  const failed = message?.isError === true || event.data?.isError === true
  const MAX_RESULT_CHARS = 8000
  const output = text === ''
    ? undefined
    : (text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text)
  return {
    ...(output === undefined ? {} : { output }),
    ...(failed ? { failed: true } : {}),
  }
}

/** live 合并：连续工具调用归入同一张卡片，组内逐条保留（可分别展开）。 */
export function appendToolCall(rows: Row[], item: ToolCallItem, seq: number): Row[] {
  const last = rows[rows.length - 1]
  if (last?.kind === 'tool') {
    const tools = [...(last.tools ?? []), item]
    return [...rows.slice(0, -1), { ...last, seq, tools, text: toolLine(tools), status: 'running' }]
  }
  return [...rows, { seq, id: seq, kind: 'tool', text: item.summary, tools: [item], status: 'running' }]
}

/** live 合并：若最后一行是工具行则并入，否则新增一行。 */
export function appendLiveRow(
  rows: Row[],
  kind: Row['kind'],
  text: string,
  seq: number,
  images?: ImageAttachmentRef[],
  at?: number,
): Row[] {
  if (kind === 'tool') return appendToolCall(rows, { name: '', summary: text, status: 'running' }, seq)
  return [...rows, { seq, id: seq, kind, text, ...(images === undefined || images.length === 0 ? {} : { images }), ...(at === undefined ? {} : { at }) }]
}

/** 标记最后一个工具调用完成；组内全部完成后整张卡片转为完成态。 */
export function completeLastTool(
  rows: Row[],
  seq: number,
  result: { output?: string; failed?: boolean } = {},
): Row[] {
  const last = rows[rows.length - 1]
  if (last?.kind !== 'tool') return rows
  const tools = (last.tools ?? []).map((item, index, all) =>
    index === all.length - 1 ? { ...item, status: 'complete' as const, ...result } : item)
  return [...rows.slice(0, -1), { ...last, seq, tools, status: 'complete' }]
}

/** 一页历史里最早一条事件的 seq；没有可用 seq 时返回 null（不可再向前翻页）。 */
export function oldestEventSeq(events: readonly SessionEventView[]): number | null {
  for (const event of events) {
    if (typeof event.seq === 'number') return event.seq
  }
  return null
}

/**
 * 把更早一页历史拼到当前对话顶部。分页切点可能落在一次工具运行中间，两张
 * 相邻的工具卡这时接回一张，避免同一次运行显示成两段。
 */
export function prependHistoryRows(
  rows: Row[],
  events: readonly SessionEventView[],
  nextSeq: () => number,
  locale: UiLocale = getUiLocale(),
): Row[] {
  const older = mergeHistoryRows([...events], nextSeq, locale)
  if (older.length === 0) return rows
  const lastOlder = older[older.length - 1]
  const firstCurrent = rows[0]
  if (lastOlder?.kind === 'tool' && firstCurrent?.kind === 'tool') {
    const tools = [...(lastOlder.tools ?? []), ...(firstCurrent.tools ?? [])]
    const rejoined: Row = {
      ...lastOlder,
      tools,
      text: tools.map((item) => item.summary).join(' → '),
      status: firstCurrent.status ?? lastOlder.status,
    }
    return [...older.slice(0, -1), rejoined, ...rows.slice(1)]
  }
  return [...older, ...rows]
}

/** 历史渲染：一次运行的工具调用归并成一张卡片，组内逐条保留（不逐条刷屏，
 * 也不丢细节——展开卡片即可逐条回看）。
 */
export function mergeHistoryRows(
  events: SessionEventView[],
  nextSeq: () => number,
  locale: UiLocale = getUiLocale(),
): Row[] {
  const rows: Row[] = []
  let pendingTool: { items: ToolCallItem[]; at?: number } | null = null
  const flushTool = (): void => {
    if (pendingTool === null) return
    const seq = nextSeq()
    rows.push({
      seq,
      id: seq,
      kind: 'tool',
      text: toolLine(pendingTool.items),
      tools: pendingTool.items,
      status: 'complete',
      ...(pendingTool.at === undefined ? {} : { at: pendingTool.at }),
    })
    pendingTool = null
  }
  for (const ev of events) {
    if (ev.type === 'tool/call') {
      const name = ev.data?.name ?? 'tool'
      const args = ev.data?.arguments
      const item: ToolCallItem = {
        name,
        summary: toolSummary(name, args, locale),
        status: 'complete',
        ...(args === undefined ? {} : { args: String(args) }),
      }
      if (pendingTool === null) {
        pendingTool = { items: [item], ...(ev.time === undefined ? {} : { at: ev.time }) }
      }
      else {
        pendingTool.items.push(item)
      }
      continue
    }
    if (ev.type === 'tool/result') {
      // 结果挂到这次运行的最后一条调用上：输入/输出成对展示。
      const pending = pendingTool
      const last = pending?.items[pending.items.length - 1]
      if (pending !== null && last !== undefined) {
        pending.items[pending.items.length - 1] = { ...last, status: 'complete', ...toolResultOf(ev) }
      }
      continue
    }
    // 只有真正产生一行的消息才结束工具组：step/start、step/end、
    // session-log-deepseek/* 这类记账事件，以及只有 tool_use 块的
    // assistant/message 都不该把一次运行切成一堆单条卡片。
    const row = rowFromEvent(ev)
    if (row === null) continue
    flushTool()
    const seq = nextSeq()
    rows.push({ ...row, seq, id: seq })
  }
  flushTool()
  return rows
}
