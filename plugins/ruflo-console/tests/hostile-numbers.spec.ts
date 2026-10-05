/**
 * Numbers another process wrote, at the edges: a timestamp past Date's range (toISOString would throw and take a page down), negative
 * and huge counts (repeat() throws, 1e+302M / -Infinity% drawn), and feed items of one read sharing a time (their ids collided).
 *   npx vitest run plugins/ruflo-console/tests/hostile-numbers.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { countOf, dateMsOf, isoOf, MAX_DATE_MS, ratioOf } from '../hooks/data/bounds'
import { diffEvents } from '../hooks/data/events'
import type { ReadCache, ReaderFs } from '../hooks/data/files'
import { parseModStatus } from '../hooks/data/mods'
import { msOf } from '../hooks/data/parse'
import { roomFeed } from '../hooks/data/room'
import { readSnapshot, type Snapshot } from '../hooks/data/snapshot'
import { lineageOf } from '../hooks/gfx/evolve'
import { gauge, memLines } from '../hooks/memory-lines'
import { roomOf } from '../hooks/room'
import { newState, VIEWS } from '../hooks/state'
import { setLook, type Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'
import { xruvLines } from '../hooks/xruv'
import { MISSION_OBSERVATION } from './fixtures/missions'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const act: Actions = (() => {
  const handler: ProxyHandler<() => void> = { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined }
  const proxy: unknown = new Proxy(() => undefined, handler)
  return proxy as Actions
})()

const memoryFs = (f: Record<string, string>): ReaderFs => ({
  read: async path => f[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async path => (f[path] !== undefined ? { mtimeMs: 1, size: (f[path] as string).length, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
  list: async path => {
    const prefix = `${path}/`
    const names = new Set(Object.keys(f).filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length).split('/')[0] as string))

    if (names.size === 0) throw new Error('ENOENT')

    return [...names].map(name => ({ name, kind: Object.keys(f).some(p => p.startsWith(`${prefix}${name}/`)) ? 'directory' : 'file' }))
  },
})

/** Every number in a JSON value replaced by `n`. */
const numbers = (value: unknown, n: number): unknown =>
  typeof value === 'number' ? n : Array.isArray(value) ? value.map(v => numbers(v, n)) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, numbers(v, n)])) : value

/** The run fixture with every number in every JSON file set to `n` (a mod status file keeps version 1 so it is read). */
async function snapshotWith(n: number, only?: string): Promise<Snapshot> {
  const base: Record<string, string> = { ...RUFLO_FILES, '.claude-flow/missions/observation.json': MISSION_OBSERVATION, '.claude-flow/evil-mod/status.json': JSON.stringify({ version: 1, guard: true, calls: 3, blocked: 1, updatedMs: 2, startedMs: 1 }) }
  const files: Record<string, string> = {}

  for (const [path, text] of Object.entries(base)) {
    let out = text

    if (only === undefined || path === only) {
      try {
        const value = numbers(JSON.parse(text), n) as Record<string, unknown>

        out = JSON.stringify(path.includes('-mod/') ? { ...value, version: 1 } : value)
      } catch {
        // not JSON: kept as written
      }
    }

    files[`/work/${path}`] = out
  }

  return readSnapshot(memoryFs(files), new Map() as ReadCache, '/work', '/home/dev', {}, 0)
}

const drawn = (f: () => unknown): string => {
  try {
    f()

    return 'drew'
  } catch (error) {
    return `threw ${String(error)}`
  }
}

describe('timestamps past Date’s range', () => {
  it('the bounds helpers hold Date’s own range and drawable counts, and never throw', () => {
    expect(isoOf(MAX_DATE_MS)).toBe('+275760-09-13T00:00:00.000Z')
    expect([isoOf(MAX_DATE_MS + 1), isoOf(1e300), isoOf(-1e17), isoOf(Number.NaN), isoOf(null)]).toEqual([undefined, undefined, undefined, undefined, undefined])
    expect([dateMsOf(1e17), dateMsOf(0), dateMsOf(-5), dateMsOf(1_700_000_000_000)]).toEqual([undefined, undefined, undefined, 1_700_000_000_000])
    expect([msOf(1e17), msOf(9e15), msOf(1_700_000_000_000), msOf('2026-10-05T00:00:00Z')]).toEqual([undefined, undefined, 1_700_000_000_000, Date.parse('2026-10-05T00:00:00Z')])
    expect([countOf(-1), countOf(Number.NaN), countOf(1e308), countOf(2.9), countOf('3')]).toEqual([undefined, undefined, Number.MAX_SAFE_INTEGER, 2, undefined])
    expect([ratioOf(-1), ratioOf(1e308), ratioOf(0.25), ratioOf(Number.POSITIVE_INFINITY)]).toEqual([0, 1, 0.25, undefined])
  })

  it('a mod status.json with updatedMs 1e300 and startedMs 9e15 keeps the Room drawing with its detail open', () => {
    const state = newState({})
    const row = parseModStatus('evil-mod', JSON.stringify({ version: 1, guard: true, calls: 1, blocked: 0, updatedMs: 1e300, startedMs: 9e15 }))

    expect(row).toMatchObject({ updatedMs: null, startedMs: null })
    state.snapshot = { mods: { rows: [{ ...row, updatedMs: 1e300, startedMs: 9e15 }], refused: 0, truncated: false } } as never
    roomOf(state).mod = 'evil'
    state.view = 'room'
    expect(drawn(() => viewText({ state, nowMs: Date.now(), columns: 120, act }, 'room'))).toBe('drew')
    expect(viewText({ state, nowMs: Date.now(), columns: 120, act }, 'room')).toMatch(/last wrote\s+\S+.*\(out of range\)/)
  })

  it('one federation claim with expiresAt 1e17 leaves the rest of the claims board drawn', () => {
    const stdout = JSON.stringify({ untrusted: true, relay: 'wss://relay', data: { 'repo/a': { owner: 'npub1aaaaaaaaaaaa', expiresAt: 1e17 }, 'repo/b': { owner: 'npub1bbbbbbbbbbbb', expiresAt: 1_790_000_000_000 } } })
    const lines = xruvLines('x-claims', stdout)

    expect(lines.join('\n')).toContain('2 claimed resources')
    expect(lines.find(line => line.startsWith('repo/a'))).not.toContain('until')
    expect(lines.find(line => line.startsWith('repo/b'))).toContain('until 2026-')
  })

  it('a memory entry or list row with a time of 1e17 opens in the Memory Lab without one', () => {
    expect(memLines('mem-get', JSON.stringify({ key: 'k', namespace: 'n', value: 'hello', updatedAt: 1e17 }))[0]).not.toContain('updated')
    expect(memLines('mem-list', JSON.stringify({ total: 1, entries: [{ key: 'k', namespace: 'n', size: 3, updatedAt: 1e17 }] }))).toEqual(['1 entry', '◇ n/k · 3 B'])
  })

  it('an evolve lineage row whose time is out of range draws without a date', () => {
    const files = { flywheel: null, receipts: null, generations: [{ generation: 1, parent: null, candidate: 'cand-1', isPromoted: true, atMs: 1e17 }], served: null, policy: null, manifests: [], hasRgiDb: false, readAtMs: 0 }

    expect(drawn(() => lineageOf(files as never))).toBe('drew')
  })
})

describe('counts that are negative, huge or not whole', () => {
  it('gauge never throws and never overfills, whatever part it is given', () => {
    expect(gauge(-24, 10, 8)).toBe('░░░░░░░░')
    expect(gauge(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, 8)).toBe('░░░░░░░░')
    expect(gauge(Number.NaN, 10, 8)).toBe('░░░░░░░░')
    expect(gauge(50, 10, 8)).toBe('████████')
    expect(gauge(5, 10, 8)).toBe('████░░░░')
  })

  it('a neural/stats.json whose counts are negative leaves the Learning page drawing, the counts not reported', async () => {
    const state = newState({})

    state.snapshot = await snapshotWith(-1, '.claude-flow/neural/stats.json')
    state.view = 'learning'
    expect(state.snapshot.neural).toEqual({})
    expect(drawn(() => viewText({ state, nowMs: 5_000, columns: 120, act }, 'learning'))).toBe('drew')
  })

  for (const n of [-1, 1e308, -1e308, 1e17, 0.0000001]) {
    it(`every number in every file set to ${n}: every view (Room with a mod open) draws, and no NaN, Infinity, exponent or negative share`, async () => {
      setLook('plain')
      const state = newState({})

      state.snapshot = await snapshotWith(n)
      // The Room with the mod's detail open: it draws the mod's times as ISO text.
      roomOf(state).mod = 'evil'
      const problems: string[] = []

      for (const view of VIEWS) {
        state.view = view.id
        try {
          const screen = viewText({ state, nowMs: 5_000, columns: 120, act }, view.id)

          for (const line of screen.split('\n')) if (/\bNaN\b|Infinity|\bundefined\b|e\+\d{2,}|-\d+%|\$-/.test(line)) problems.push(`${view.id}: ${line.trim().slice(0, 140)}`)
        } catch (error) {
          problems.push(`${view.id}: threw ${String(error)}`)
        }
      }

      expect(problems).toEqual([])
    })
  }
})

describe('room feed ids', () => {
  const snap = (agents: Snapshot['agents']): Snapshot => ({ agents, claims: [], tasks: [], swarm: null, hive: null, neural: null, outcomes: null, missions: null, federationNodes: null, hasNostrKey: null }) as unknown as Snapshot

  it('two agents of one type spawned in one read get distinct, stable feed ids', () => {
    const events = diffEvents(snap([]), snap([{ id: 'agent-1-aaaaaa', type: 'coder', status: 'idle' }, { id: 'agent-1-bbbbbb', type: 'coder', status: 'idle' }]), 1_000)
    const feed = () => roomFeed({ events, log: [], said: [], pending: null, outcome: null, source: 'all', query: '', untilMs: null }).map(item => item.id)

    expect(events).toHaveLength(2)
    expect(new Set(feed()).size).toBe(2)
    expect(feed()).toEqual(feed())
  })
})
