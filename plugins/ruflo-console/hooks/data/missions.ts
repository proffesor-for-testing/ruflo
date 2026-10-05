/**
 * ADR-406 mission observation (`ruflo.mission-observation/1`): `.claude-flow/missions/observation.json`, written
 * atomically by the ruflo CLI after each committed mission event. Read-only here. The console never mutates it, never
 * infers execution from it, shows task status as recorded (only `evidence.verified` is verified), and never shows a
 * disconnected executor as failed. Freshness comes from the file's `observedAt`, never from a redraw.
 */
import { countOf, minorOf } from './bounds'
import { jsonObject, msOf, plain, recordOf, stringOf } from './parse'

export const MISSION_CONTRACT = 'ruflo.mission-observation/1'
export const MISSION_STATES = ['draft', 'planned', 'awaitingAuthorization', 'queued', 'running', 'pauseRequested', 'paused', 'blocked', 'verifying', 'completed', 'failed', 'cancelRequested', 'cancelled'] as const

export type MissionTask = { id: string; title: string; dependsOn: string[]; status: string }

export type Mission = {
  id: string
  objective: string
  state: string
  revision: number
  executionMode: string
  plan: { revision: number; taskCount: number; tasks: MissionTask[] }
  budget: { currency: string; ceilingMinor?: number; estimatedMinor?: number; reservedMinor?: number; settledMinor?: number; unresolvedMinor?: number } | null
  evidence: { count: number; verified: number }
  executor: { connection: string; observedAtMs?: number } | null
  unresolvedOperations: number
  blockedReason?: string
  updatedAtMs?: number
}

export type MissionObservation = { observedAtMs: number | null; isTruncated: boolean; missions: Mission[] }

const ID = /^[A-Za-z0-9_.:-]{1,80}$/

/** The observation, or null for a missing file, another contract, or any shape this version does not read. */
export function parseMissions(text: string | null): MissionObservation | null {
  const value = jsonObject(text)

  if (value === null || value.contract !== MISSION_CONTRACT || value.schemaVersion !== 1 || !Array.isArray(value.missions)) {
    return null
  }

  const missions = value.missions.slice(0, 50).flatMap(entry => {
    const mission = recordOf(entry)
    const id = typeof mission?.missionId === 'string' && ID.test(mission.missionId) ? mission.missionId : null

    if (mission === null || id === null) return []

    const plan = recordOf(mission.plan)
    const budget = recordOf(mission.budget)
    const evidence = recordOf(mission.evidence)
    const executor = recordOf(mission.executor)
    const tasks = (Array.isArray(plan?.tasks) ? plan.tasks : []).slice(0, 50).flatMap(raw => {
      const task = recordOf(raw)
      const taskId = typeof task?.id === 'string' && ID.test(task.id) ? task.id : null

      return task === null || taskId === null
        ? []
        : [{ id: taskId, title: plain(task.title, 80), dependsOn: (Array.isArray(task.dependsOn) ? task.dependsOn : []).slice(0, 20).flatMap(dep => (typeof dep === 'string' && ID.test(dep) ? [dep] : [])), status: stringOf(task.status, 20) ?? 'unknown' }]
    })
    const count = countOf(evidence?.count) ?? 0
    const out: Mission = {
      id,
      objective: plain(mission.objective, 200),
      state: stringOf(mission.state, 30) ?? 'unknown',
      revision: countOf(mission.revision) ?? 0,
      executionMode: stringOf(mission.executionMode, 30) ?? 'unknown',
      // The plan holds at least the tasks the record lists (a smaller or hostile taskCount would hide them).
      plan: { revision: countOf(plan?.revision) ?? 0, taskCount: Math.max(countOf(plan?.taskCount) ?? 0, tasks.length), tasks },
      budget:
        budget === null
          ? null
          : {
              currency: stringOf(budget.currency, 8) ?? '?',
              ...Object.fromEntries((['ceilingMinor', 'estimatedMinor', 'reservedMinor', 'settledMinor', 'unresolvedMinor'] as const).flatMap(key => (minorOf(budget[key]) !== undefined ? [[key, minorOf(budget[key])]] : []))),
            },
      evidence: { count, verified: Math.min(countOf(evidence?.verified) ?? 0, count) },
      executor: executor === null ? null : { connection: stringOf(executor.connection, 20) ?? 'unknown', ...(msOf(executor.observedAt) !== undefined && { observedAtMs: msOf(executor.observedAt) }) },
      unresolvedOperations: countOf(mission.unresolvedOperations) ?? 0,
    }
    const blocked = stringOf(mission.blockedReason, 120)
    const updated = msOf(mission.updatedAt)

    if (blocked !== undefined) out.blockedReason = blocked
    if (updated !== undefined) out.updatedAtMs = updated

    return [out]
  })

  return { observedAtMs: msOf(value.observedAt) ?? null, isTruncated: value.truncated === true, missions }
}

/** Minor units as money: 1000 USD minor → "$10.00"; other currencies by code; n/a for anything minorOf refuses (never `$-1e+306`). */
export function money(minor: number | undefined, currency: string): string {
  const held = minorOf(minor)

  if (held === undefined) return 'n/a'

  const major = (held / 100).toFixed(2)

  return currency === 'USD' ? `$${major}` : `${major} ${currency}`
}
