/**
 * Auto-run's spend guard (ADR-443): a leaf module, so `advance()` in mission-control.ts can ask it without a cycle. The spend is the
 * cost ledger's reading for the mission's window and project (the `mission-cost` probe), a list-price estimate; the cap is the person's
 * own Settings value. No cap means no guard. With a cap, auto-run hands out a task only on a fresh reading for this mission: a reading
 * older than MISSION_COST_STALE_MS (the probe stopped, or never ran) is unknown, and an unknown spend is not "below the cap".
 */
import { capState, capUsd, MISSION_COST_STALE_MS, shouldPause, type MissionCost } from './data/mission-cost'
import { live } from './views/common'
import { settingsOf } from './settings'
import type { MissionRecord } from './mission-types'
import type { State } from './state'

/** The mission's cost reading, only while it is the one the probe was asked about (its window starts when the mission did). */
export function costOf(state: State, mission: MissionRecord): MissionCost | null {
  const cost = live<MissionCost>(state.probes.get('mission-cost'))

  return cost !== null && cost.fromMs === mission.createdAtMs ? cost : null
}

/** The cap in dollars, on the same 0.01 to 10000 rule as the Settings field; anything else (`0` included) is no cap, and shows as none. */
export const capOf = (state: State): number | null => capUsd(settingsOf(state).ai.missionCapUsd)

/** What the guard knows about this mission's spend against its cap. */
export type CapVerdict = 'no-cap' | 'below' | 'reached' | 'unknown'

export function capVerdict(state: State, mission: MissionRecord, nowMs = Date.now()): CapVerdict {
  const cap = capOf(state)

  if (cap === null) return 'no-cap'

  const result = state.probes.get('mission-cost')
  const cost = result?.value as MissionCost | null | undefined

  if (cost === null || cost === undefined || cost.fromMs !== mission.createdAtMs) return 'unknown'

  // Spend inside a window only grows: a reading at the cap stays true however old it is.
  if (shouldPause(capState(cost.usd, cap), true)) return 'reached'
  if (cost.usd === null || result?.okAtMs === null || result?.okAtMs === undefined || nowMs - result.okAtMs > MISSION_COST_STALE_MS || nowMs < result.okAtMs) return 'unknown'

  return 'below'
}

/** True when auto-run should stop handing out tasks because this mission's spend reached its cap. */
export const isCapReached = (state: State, mission: MissionRecord): boolean => mission.auto && capVerdict(state, mission) === 'reached'

/**
 * Auto-run's hand-out count per task, kept on the mission record itself (it is saved with the ledger) and never rebuilt from the event
 * log: the log keeps only its last 500 events, so calls that each record one could push the old hand-outs out and reset the count.
 * Only the person's own go-ahead (auto-run turned on, or a resume, that changed something) starts it again.
 */
export const handoutsOf = (mission: MissionRecord, taskId: string): number => (mission.handouts !== undefined && Object.hasOwn(mission.handouts, taskId) ? (mission.handouts[taskId] ?? 0) : 0)

export function countHandout(mission: MissionRecord, taskId: string): void {
  const handouts = mission.handouts ?? (mission.handouts = Object.create(null) as Record<string, number>)

  handouts[taskId] = handoutsOf(mission, taskId) + 1
}

export const resetHandouts = (mission: MissionRecord): void => void (mission.handouts = Object.create(null) as Record<string, number>)

/** A stored count as loaded: a plain object of this mission's own task ids to whole numbers of hand-outs, or nothing at all. */
export function parseHandouts(raw: unknown, taskIds: readonly string[]): Record<string, number> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined

  const proto = Object.getPrototypeOf(raw) as unknown

  if (proto !== Object.prototype && proto !== null) return undefined

  const keys = Object.getOwnPropertyNames(raw)
  const out = Object.create(null) as Record<string, number>

  if (keys.length > taskIds.length || Object.getOwnPropertySymbols(raw).length > 0) return undefined

  for (const key of keys) {
    const value = (raw as Record<string, unknown>)[key]

    if (!taskIds.includes(key) || typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined
    out[key] = value
  }

  return out
}
