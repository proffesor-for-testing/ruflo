import { countOf, dateMsOf, ratioOf } from './bounds'
import { jsonObject, plain, recordOf } from './parse'

/** What the ruflo-agentdb mod last wrote to `.claude-flow/agentdb-mod/status.json` (ADR-445): its settings, counters and the last items it attached. */
export type AgentdbMod = {
  recall: boolean
  guard: boolean
  source: string
  tool: string | null
  updatedMs: number
  attached: number
  skipped: number
  cached: number
  timedOut: number
  dropped: number
  blocked: number
  errors: number
  lastMs: number | null
  recent: { source: string; score: number | null; snippet: string }[]
}

/** A counter as the mod wrote it, whole and bounded (countOf): a hostile 1e308 is held at the ceiling, a negative or missing one is 0. */
const whole = (v: unknown): number => countOf(v) ?? 0

/** A recall score: the mod keeps items scoring 0.25 and up from cosine-like readers (0..1), so anything outside 0..1 is not a score it wrote. */
const scoreOf = (v: unknown): number | null => (typeof v === 'number' && ratioOf(v) === v ? v : null)

/** Parses the status file; anything that is not version 1 of its shape is null (the console never guesses at a shape it does not know). */
export function parseAgentdbMod(text: string | null): AgentdbMod | null {
  const value = jsonObject(text)

  if (value === null || value.version !== 1) return null

  const recent = (Array.isArray(value.recent) ? value.recent : []).slice(-5).flatMap(item => {
    const r = recordOf(item)

    return r !== null && typeof r.snippet === 'string' ? [{ source: typeof r.source === 'string' ? plain(r.source, 24) : '?', score: scoreOf(r.score), snippet: plain(r.snippet, 120) }] : []
  })

  return {
    recall: value.recall === true,
    guard: value.guard === true,
    source: typeof value.source === 'string' ? plain(value.source, 16) : 'auto',
    tool: typeof value.lastTool === 'string' ? plain(value.lastTool, 24) : null,
    updatedMs: dateMsOf(value.updatedMs) ?? 0,
    attached: whole(value.attached),
    skipped: whole(value.skipped),
    cached: whole(value.cached),
    timedOut: whole(value.timedOut),
    dropped: whole(value.dropped),
    blocked: whole(value.blocked),
    errors: whole(value.errors),
    lastMs: countOf(value.lastMs) ?? null,
    recent,
  }
}
