/**
 * Every probe of the cost-tracker plugin's ledger: the Cost page's seven-day reading, and the active mission's spend (ADR-443). The
 * mission's needs a newer tracker than the Cost page's (the `--from`, `--to` and `--project` filters), so an older one is "not ready",
 * and the probe does not run. Local only: nothing here reaches the network.
 */
import { activeMission } from '../mission-control'
import { bumpKind, parseSemver } from '../updates'
import type { State } from '../state'
import { COST_PLUGIN, costLedgerProbe, trackerOf } from './cost-ledger'
import { MISSION_COST_EVERY_MS, missionCostArgv, parseMissionCost, type MissionCost } from './mission-cost'
import type { Probe } from './cli'

/** The first tracker release whose ledger takes the window and project filters. */
export const MISSION_COST_FROM = '0.27.1'

function missionCostArgs(state: State): readonly string[] | null {
  const tracker = trackerOf(state)
  const mission = activeMission(state)

  if (tracker.kind !== 'ready' || mission === null) return null

  const version = state.snapshot?.plugins.installed?.find(plugin => plugin.id === COST_PLUGIN)?.version ?? ''

  // Older than the filters (or not a version we can read): not ready, never guessed at.
  if (parseSemver(version) === null || bumpKind(version, MISSION_COST_FROM) !== null) return null

  // A finished or cancelled mission's window closes at its last event; a live one stays open at the right.
  const end = mission.cancelled ? Math.max(mission.createdAtMs, ...mission.events.map(event => event.atMs)) : null

  return missionCostArgv(tracker.root, mission.createdAtMs, end, state.cwd)
}

/** Auto-run's spend guard reads this probe on every refresh, whatever page is in front: while the active mission auto-runs, it keeps reading. */
const isAutoRunning = (state: State): boolean => activeMission(state)?.auto === true

export const missionCostProbe: Probe<MissionCost> = {
  id: 'mission-cost', args: [], argvOf: missionCostArgs, views: ['missions'], isWanted: isAutoRunning, everyMs: MISSION_COST_EVERY_MS, timeoutMs: 60_000, parse: parseMissionCost,
}

export const ALL_COST_PROBES = [costLedgerProbe, missionCostProbe] as const
