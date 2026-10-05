/**
 * Shared by the hostile-number sweeps: an in-memory project whose JSON files have every number replaced, the probe answers the CLI
 * printed with the same replacement, and the pattern a drawn line must never match.
 */
import type { ReadCache, ReaderFs } from '../../hooks/data/files'
import { readSnapshot, type Snapshot } from '../../hooks/data/snapshot'
import type { Actions } from '../../hooks/views/common'
import { MISSION_OBSERVATION } from './missions'
import { CLI_OUT, RUFLO_FILES } from './ruflo-run'

/** An Actions stand-in: every property is a callable that does nothing, so a view can wire its buttons. */
export const act: Actions = (() => {
  const handler: ProxyHandler<() => void> = { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined }
  const proxy: unknown = new Proxy(() => undefined, handler)

  return proxy as Actions
})()

export const memoryFs = (f: Record<string, string>): ReaderFs => ({
  read: async path => f[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async path => (f[path] !== undefined ? { mtimeMs: 1, size: (f[path] as string).length, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
  list: async path => {
    const prefix = `${path}/`
    const names = new Set(Object.keys(f).filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length).split('/')[0] as string))

    if (names.size === 0) throw new Error('ENOENT')

    return [...names].map(name => ({ name, kind: Object.keys(f).some(p => p.startsWith(`${prefix}${name}/`)) ? 'directory' : 'file' }))
  },
})

/** Keys that say which shape a file is: kept as written, so the reader takes the file and its numbers reach the screen. */
const SHAPE_KEYS = new Set(['schemaVersion', 'version'])

/** Every number in a JSON value replaced by `n`, except a schema version. */
export const numbers = (value: unknown, n: number): unknown =>
  typeof value === 'number'
    ? n
    : Array.isArray(value)
      ? value.map(v => numbers(v, n))
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SHAPE_KEYS.has(k) ? v : numbers(v, n)]))
        : value

/** What the ruflo-agentdb mod writes (plugins/ruflo-agentdb/hooks/status.ts): counters, the last latency and the recent attached items with scores. */
export const AGENTDB_MOD_STATUS = JSON.stringify({ version: 1, updatedMs: 4_000, recall: true, guard: true, source: 'auto', attached: 3, skipped: 1, timedOut: 0, cached: 1, dropped: 0, blocked: 0, errors: 1, lastMs: 12, lastTool: 'memory', recent: [{ atMs: 4_000, source: 'mem', score: 0.5, snippet: 'hello' }] })

/** `.claude-flow/agents.json` (hive-mind spawned workers): the agent store's shape with a hive role on each agent. */
export const HIVE_AGENTS = (() => {
  const store = JSON.parse(RUFLO_FILES['.claude-flow/agents/store.json'] as string) as { agents: Record<string, Record<string, unknown>> }

  for (const agent of Object.values(store.agents)) agent.config = { ...(agent.config as object | undefined), hiveRole: 'worker' }

  return JSON.stringify(store)
})()

/** Every project file the console reads, as captured from a real run plus the mission record, a mod's status and both agent stores. */
export const PROJECT_FILES: Readonly<Record<string, string>> = {
  ...RUFLO_FILES,
  '.claude-flow/missions/observation.json': MISSION_OBSERVATION,
  '.claude-flow/evil-mod/status.json': JSON.stringify({ version: 1, guard: true, calls: 3, blocked: 1, updatedMs: 2, startedMs: 1 }),
  '.claude-flow/agentdb-mod/status.json': AGENTDB_MOD_STATUS,
  '.claude-flow/agents.json': HIVE_AGENTS,
}

/** The project with every number in every JSON file (or only `only`) set to `n`, schema versions kept so every file is still read. */
export async function snapshotWith(n: number, only?: string): Promise<Snapshot> {
  const files: Record<string, string> = {}

  for (const [path, text] of Object.entries(PROJECT_FILES)) {
    let out = text

    if (only === undefined || path === only) {
      try {
        out = JSON.stringify(numbers(JSON.parse(text), n))
      } catch {
        // not JSON: kept as written
      }
    }

    files[`/work/${path}`] = out
  }

  return readSnapshot(memoryFs(files), new Map() as ReadCache, '/work', '/home/dev', {}, 0)
}

/**
 * What each CLI probe printed, by probe id: the captured runs where there is one, else an answer of the documented shape (roster,
 * registry, model-stats and research reach the network or another plugin, so the run captured none).
 */
export const PROBE_OUT: Readonly<Record<string, string>> = {
  memory: CLI_OUT['memory-stats'] as string,
  namespaces: CLI_OUT['memory-list'] as string,
  metaharness: CLI_OUT['mh-score'] as string,
  flywheel: CLI_OUT['mh-flywheel'] as string,
  audits: CLI_OUT['mh-audit-list'] as string,
  intelligence: CLI_OUT.intel as string,
  peers: `Result:\n${JSON.stringify({ peers: [{ nodeId: 'node-a', lastSyncAt: 1_790_000_000_000 }] })}\n`,
  channels: `Result:\n${JSON.stringify({ channels: [{ channel: 'ch-1', name: 'ops', at: 1_790_000_000_000 }] })}\n`,
  roster: `Result:\n${JSON.stringify({ relay: 'wss://relay.ruv.io', retrievedAt: 1_790_000_000_000, data: [{ name: 'node-a', detail: 'member since 3 days' }] })}\n`,
  registry: `Result:\n${JSON.stringify({ relay: 'wss://relay.ruv.io', registration: { enabled: true, endpoint: 'https://x.ruv.io/join', authentication: 'nip-42', limits: { perHour: 60, burst: 5 } }, join: ['ask for an invite'], defaultChannels: [{ channel: 'swarm', purpose: 'coordination' }] })}\n`,
  'model-stats': JSON.stringify({ available: true, totalDecisions: 11, modelDistribution: { sonnet: 6, opus: 5 } }),
  research: JSON.stringify({ version: 1, records: [{ question: 'which store?', status: 'done', depth: 'quick', findings: [{ grade: 'A' }], spentUsd: 0.12, capUsd: 2, at: '2026-10-02T00:00:00Z' }] }),
}

/** A CLI answer with every number in its JSON set to `n` (the text around the JSON kept), or null when it holds none. */
export function hostileStdout(text: string, n: number): string | null {
  for (const open of ['{', '[']) {
    const at = text.indexOf(open)

    if (at < 0) continue
    for (let end = text.length; end > at; end--) {
      try {
        const value: unknown = JSON.parse(text.slice(at, end))

        return text.slice(0, at) + JSON.stringify(numbers(value, n)) + text.slice(end)
      } catch {
        // a shorter span
      }
    }
  }

  return null
}

/**
 * What a drawn line must never hold: NaN, Infinity or undefined; exponent notation (1e+308, 1e-7); a minus before a digit that is not
 * part of a date or an id (-1 runs, $-0.01); a negative percent; a long fraction (12.3456789: five or more digits after the point).
 */
export const SWEEP = /\bNaN\b|Infinity|\bundefined\b|\de[+-]\d|(^|[\s/$(:[])-\d|-\d+%|\d\.\d{5,}/

/** A section set that answers yes for every key: every collapsible section drawn flipped from its default (closed ones open). */
export class AllFlipped extends Set<string> {
  override has(): boolean {
    return true
  }
}
