import type { PendingQuestion, ResolvedQuestion, SessionEventView } from './events.ts'
import { removePendingQuestion, upsertPendingQuestion } from './pending-questions.ts'

/** Minimal session.list row needed by the side-panel picker. */
export interface SessionPickerEntry {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  origin?: 'subagent'
  projections?: {
    asOfSeq: number
    values: Record<string, unknown>
  }
}

/** Only ordinary, started conversations can be resumed through session.prompt. */
export function resumableSessions(items: readonly SessionPickerEntry[]): SessionPickerEntry[] {
  return items.filter((entry) => !entry.blank && entry.origin !== 'subagent')
}

/** Match dsh's display-title fallback without loading a session's history. */
export function sessionDisplayTitle(entry: SessionPickerEntry): string {
  const projectedTitle = projectedSessionTitle(entry)
  if (projectedTitle !== undefined) return projectedTitle

  const normalizedCwd = entry.cwd?.replace(/[\\/]+$/u, '')
  const directoryName = normalizedCwd?.split(/[\\/]/u).at(-1)
  return directoryName === undefined || directoryName === '' ? entry.sessionId : directoryName
}

/** Read the durable title column carried by dsh's session.list projection. */
export function projectedSessionTitle(entry: SessionPickerEntry): string | undefined {
  return normalizeSessionTitle(entry.projections?.values.title)
}

/** Localized workspace names the picker needs; other workspaces use their folder name. */
export interface SessionPickerLabels {
  /** Display name of the default `default-workspace` directory. */
  defaultWorkspace: string
  /** Display name of the extension's own `browser-sessions` group. */
  browserSessions: string
  /** Shown instead of a title for a session that never got one. */
  untitled: string
}

/** Folder names dsh gives the two groups the panel itself surfaces. */
const DEFAULT_WORKSPACE_DIR = 'default-workspace'
const BROWSER_SESSIONS_DIR = 'browser-sessions'

/** Last path segment of a working directory, trailing separators removed. */
function cwdBasename(cwd: string | undefined): string | undefined {
  const normalized = cwd?.replace(/[\\/]+$/u, '')
  const name = normalized?.split(/[\\/]/u).at(-1)
  return name === undefined || name === '' ? undefined : name
}

/** The workspace a session belongs to, as a short label the picker prefixes. */
export function sessionWorkspaceLabel(
  cwd: string | undefined,
  labels: SessionPickerLabels,
): string | undefined {
  const name = cwdBasename(cwd)
  if (name === undefined) return undefined
  if (name === DEFAULT_WORKSPACE_DIR) return labels.defaultWorkspace
  if (name === BROWSER_SESSIONS_DIR) return labels.browserSessions
  return name
}

/**
 * Picker label: `<workspace>-<session title>`, e.g. `浏览器-总结页面内容`.
 *
 * The workspace is omitted when the session has no working directory, so a row
 * never renders a dangling separator; a session without a durable title shows
 * the localized placeholder instead of repeating its directory name.
 */
export function sessionPickerLabel(entry: SessionPickerEntry, labels: SessionPickerLabels): string {
  const title = projectedSessionTitle(entry) ?? labels.untitled
  const workspace = sessionWorkspaceLabel(entry.cwd, labels)
  return workspace === undefined ? title : `${workspace}-${title}`
}

/** Read one durable title update from the ordinary session event stream. */
export function sessionTitleFromEvent(event: SessionEventView): string | undefined {
  return event.type === 'session/title' ? normalizeSessionTitle(event.data?.title) : undefined
}

/** Recover the newest valid title while replaying session.history. */
export function latestSessionTitle(events: readonly SessionEventView[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const title = sessionTitleFromEvent(events[index])
    if (title !== undefined) return title
  }
  return undefined
}

function normalizeSessionTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const title = value.trim()
  return title === '' ? undefined : title
}

/** A prompt target exists only after the current session transition settles. */
export function sessionAcceptsPrompts(
  connected: boolean,
  changing: boolean,
  sessionId: string | null,
): boolean {
  return connected && !changing && sessionId !== null
}

export interface SessionRuntimeSnapshot {
  running: boolean
  questions: PendingQuestion[]
}

interface StoredSessionRuntime {
  running?: boolean
  questions: PendingQuestion[]
}

/** Live, per-session state that session.history cannot reconstruct. */
export class SessionRuntimeCache {
  private readonly sessions = new Map<string, StoredSessionRuntime>()

  rememberQuestion(question: PendingQuestion): void {
    const current = this.sessions.get(question.sessionId) ?? { questions: [] }
    this.sessions.set(question.sessionId, {
      ...current,
      questions: upsertPendingQuestion(current.questions, question),
    })
  }

  resolveQuestion(question: ResolvedQuestion): void {
    const current = this.sessions.get(question.sessionId)
    if (current === undefined) return
    this.sessions.set(question.sessionId, {
      ...current,
      questions: removePendingQuestion(current.questions, question),
    })
  }

  seedRunning(sessionId: string, running: boolean): void {
    const current = this.sessions.get(sessionId) ?? { questions: [] }
    if (current.running !== undefined) return
    this.sessions.set(sessionId, { ...current, running })
  }

  startTurn(sessionId: string): void {
    const current = this.sessions.get(sessionId) ?? { questions: [] }
    this.sessions.set(sessionId, { ...current, running: true })
  }

  finishTurn(sessionId: string): void {
    this.sessions.set(sessionId, { running: false, questions: [] })
  }

  snapshot(sessionId: string, fallbackRunning = false): SessionRuntimeSnapshot {
    const current = this.sessions.get(sessionId)
    return {
      running: current?.running ?? fallbackRunning,
      questions: current?.questions.slice() ?? [],
    }
  }

  clear(): void {
    this.sessions.clear()
  }
}
