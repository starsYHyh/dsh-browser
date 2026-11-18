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

/** Localized placeholders the picker needs. */
export interface SessionPickerLabels {
  /** Shown instead of a title for a session that never got one. */
  untitled: string
}

/** Trailing separators removed; an empty path means "no workspace". */
function normalizeWorkspacePath(value: string | undefined): string | undefined {
  const normalized = value?.replace(/[\\/]+$/u, '')
  return normalized === undefined || normalized === '' ? undefined : normalized
}

/**
 * Keep only the sessions the extension itself created.
 *
 * The bridge creates them in its own workspace (`caps.sessionWorkspace`), while
 * the desktop app's conversations live in other workspaces and must not leak
 * into the panel. An unknown workspace — an older bridge, or the bridge's
 * ungrouped mode — keeps the full list, because filtering on a guess would hide
 * every row.
 */
export function browserSessions(
  items: readonly SessionPickerEntry[],
  workspace: string | undefined,
): SessionPickerEntry[] {
  const expected = normalizeWorkspacePath(workspace)
  if (expected === undefined) return [...items]
  return items.filter((entry) => normalizeWorkspacePath(entry.cwd) === expected)
}

/**
 * Picker label: the durable session title, or the localized placeholder.
 *
 * The picker only lists the extension's own workspace now, so it no longer
 * prefixes the title with `<workspace>-`.
 */
export function sessionPickerLabel(entry: SessionPickerEntry, labels: SessionPickerLabels): string {
  return projectedSessionTitle(entry) ?? labels.untitled
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
