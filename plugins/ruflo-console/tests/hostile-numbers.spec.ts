/**
 * Numbers another process wrote, at the edges: a timestamp past Date's range (toISOString would throw and take a page down), negative
 * and huge counts (repeat() throws, 1e+302M / -Infinity% drawn), and feed items of one read sharing a time (their ids collided).
 *   npx vitest run plugins/ruflo-console/tests/hostile-numbers.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { parseAutopilot, parseTemplates, parseWorkflows } from '../hooks/data/automate'
import { countOf, dateMsOf, isoOf, MAX_DATE_MS, minorOf, ratioOf } from '../hooks/data/bounds'
import { intelligenceProbe, type Intelligence } from '../hooks/data/cli'
import { diffEvents } from '../hooks/data/events'
import { money, parseMissions } from '../hooks/data/missions'
import { parseModStatus } from '../hooks/data/mods'
import { msOf } from '../hooks/data/parse'
import { roomFeed } from '../hooks/data/room'
import type { Snapshot } from '../hooks/data/snapshot'
import { lineageOf } from '../hooks/gfx/evolve'
import { gauge, memLines } from '../hooks/memory-lines'
import { mcOf } from '../hooks/mission-control'
import { roomOf } from '../hooks/room'
import { newState, VIEWS } from '../hooks/state'
import { setLook } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'
import { xruvLines } from '../hooks/xruv'
import { act, snapshotWith, SWEEP } from './fixtures/hostile'

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
    it(`every number in every file set to ${n}: every view (Room with a mod open, Missions on its record tab) draws, and no NaN, Infinity, exponent or negative`, async () => {
      setLook('plain')
      const state = newState({})

      state.snapshot = await snapshotWith(n)
      // The Room with the mod's detail open: it draws the mod's times as ISO text.
      roomOf(state).mod = 'evil'
      // Missions on the record tab: the observation's numbers, drawn (the plan tab draws none of them).
      mcOf(state).tab = 'record'
      const problems: string[] = []
      const screens = new Map<string, string>()

      for (const view of VIEWS) {
        state.view = view.id
        try {
          const screen = viewText({ state, nowMs: 5_000, columns: 120, act }, view.id)

          screens.set(view.id, screen)
          for (const line of screen.split('\n')) if (SWEEP.test(line)) problems.push(`${view.id}: ${line.trim().slice(0, 140)}`)
        } catch (error) {
          problems.push(`${view.id}: threw ${String(error)}`)
        }
      }

      expect(problems).toEqual([])
      // The sweep read real screens: every view drew something, and the record tab drew both missions with their numbers.
      for (const view of VIEWS) expect(screens.get(view.id)?.trim().length ?? 0, view.id).toBeGreaterThan(0)
      expect(state.snapshot.missions?.missions).toHaveLength(2)
      expect(screens.get('missions')).toMatch(/Mission record ─+ 2 · observed /)
      expect(screens.get('missions')).toContain('Ship a verified artifact')
      expect(screens.get('missions')).toMatch(/verified \d+\/\d+ · /)
      expect(screens.get('missions')).toMatch(/evidence \d+\/\d+ verified · budget /)
    })
  }

  it('the sweep pattern catches what the record tab drew before the fix', () => {
    for (const bad of ['verified -1e+308/-1e+308', '$-1e+306 of $-1e+306', 'rev -1e+308', 'plan rev 1e+308: (+1e+308)', '$-0.01 of $-0.01', 'tasks 0+/1e-7', '-1 runs', '(-1)', 'last 1e+308 ms', '◆ hello [mem -1.00]', '12.3456789 B']) expect(SWEEP.test(bad), bad).toBe(true)
    for (const good of ['2026-10-02 03:29', 'msn_a2852484056873a25a593d16', 'hive-worker-1790903400000-a1b2', 'rev 9007199254740991', '$10.00 of $10.00', 'sha256:f4f3e2e2', 'ruflo v3.41.2', '$0.024 · 0.8421']) expect(SWEEP.test(good), good).toBe(false)
  })
})

describe('the mission record (ADR-406 observation) with hostile numbers', () => {
  const observation = (mission: Record<string, unknown>) =>
    JSON.stringify({ schemaVersion: 1, contract: 'ruflo.mission-observation/1', observedAt: '2026-10-02T03:29:44.705Z', missions: [{ missionId: 'msn_hostile', objective: 'hostile numbers', state: 'running', executionMode: 'session-bound', ...mission }] })
  const tasks = [{ id: 'a', status: 'pending' }, { id: 'b', status: 'recorded-done' }, { id: 'c', status: 'pending' }]
  const HOSTILE = { revision: -1e308, plan: { revision: 1e308, taskCount: 1e-7, tasks }, evidence: { count: -1e308, verified: -1e308 }, unresolvedOperations: 1e308, budget: { currency: 'USD', ceilingMinor: -1e308, settledMinor: -1, estimatedMinor: 1e306, reservedMinor: 0.5, unresolvedMinor: Number.MAX_SAFE_INTEGER } }

  it('minorOf keeps whole, non-negative minor units up to 1e15 and money() draws anything else as n/a', () => {
    expect([minorOf(0), minorOf(1000), minorOf(1e15), minorOf(1e15 + 1), minorOf(-1), minorOf(0.5), minorOf(Number.NaN), minorOf('100')]).toEqual([0, 1000, 1e15, undefined, undefined, undefined, undefined, undefined])
    expect([money(1000, 'USD'), money(-1, 'USD'), money(-1e306, 'USD'), money(1e306, 'EUR'), money(Number.POSITIVE_INFINITY, 'USD'), money(0.5, 'USD'), money(1e15, 'USD')]).toEqual(['$10.00', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', '$10000000000000.00'])
  })

  it('the parser holds every count whole and non-negative, verified never above the count, and refuses out-of-range money', () => {
    const mission = parseMissions(observation(HOSTILE))?.missions[0]

    expect(mission).toMatchObject({ revision: 0, plan: { revision: Number.MAX_SAFE_INTEGER, taskCount: 3 }, evidence: { count: 0, verified: 0 }, unresolvedOperations: Number.MAX_SAFE_INTEGER })
    expect(mission?.budget).toEqual({ currency: 'USD' })
    expect(parseMissions(observation({ evidence: { count: 2, verified: 5 } }))?.missions[0]?.evidence).toEqual({ count: 2, verified: 2 })
    expect(parseMissions(observation({ plan: { taskCount: 7, tasks } }))?.missions[0]?.plan.taskCount).toBe(7)
  })

  it('Missions → record tab draws the hostile mission without an exponent, a negative or a fraction', () => {
    setLook('plain')
    const state = newState({})

    state.snapshot = { plugins: { installed: [] }, missions: parseMissions(observation(HOSTILE)) } as never
    mcOf(state).tab = 'record'
    const screen = viewText({ state, nowMs: Date.parse('2026-10-02T03:30:00Z'), columns: 200, act }, 'missions')

    expect(screen).toContain('hostile numbers')
    expect(screen).toContain('tasks 1/3 · verified 0/0 · n/a settled')
    expect(screen).toContain('rev 0 ·')
    expect(screen).toContain(`plan rev ${Number.MAX_SAFE_INTEGER}: ○ a → ● b → ○ c`)
    expect(screen).toContain('evidence 0/0 verified · budget n/a settled, n/a reserved of n/a (estimate n/a)')
    expect(screen).toContain(`${Number.MAX_SAFE_INTEGER} operation(s) unresolved`)
    expect(screen.split('\n').filter(line => /\de[+-]\d|(^|[\s/$(:])-\d|\d\.\d{3,}/.test(line))).toEqual([])
  })
})

describe('Memory Lab counts', () => {
  it('a read count or a size that is negative or huge draws as n/a or a whole number, never in exponent notation', () => {
    expect(memLines('mem-get', JSON.stringify({ key: 'k', namespace: 'n', value: 'v', accessCount: -1e308 }))[0]).toContain('read n/a×')
    expect(memLines('mem-get', JSON.stringify({ key: 'k', namespace: 'n', value: 'v', accessCount: 1e300 }))[0]).toContain(`read ${Number.MAX_SAFE_INTEGER}×`)
    expect(memLines('mem-get', JSON.stringify({ key: 'k', namespace: 'n', value: 'v', accessCount: 2.5 }))[0]).toContain('read 2×')
    expect(memLines('mem-list', JSON.stringify({ total: 3, entries: [{ key: 'k1', namespace: 'ns', size: -1 }, { key: 'k2', namespace: 'ns', size: 1e308 }, { key: 'k3', namespace: 'ns', size: 1e-7 }] }))).toEqual(['3 entries', '◇ ns/k1 · n/a B', `◇ ns/k2 · ${Number.MAX_SAFE_INTEGER} B`, '◇ ns/k3 · 0 B'])
  })
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

describe('counts the CLI answered (Automation lists and autopilot, the Learning live engine)', () => {
  const HOSTILE = /\bNaN\b|Infinity|\bundefined\b|e[+-]\d|-\d/

  it('workflow and template step counts, autopilot iterations and task progress are whole, non-negative and drawn without an exponent', () => {
    setLook('plain')
    const state = newState({})

    state.auto.workflows = parseWorkflows(JSON.stringify({ workflows: [{ workflowId: 'wf-1', name: 'nightly', status: 'running', stepCount: -1e308 }, { workflowId: 'wf-2', name: 'weekly', status: 'running', stepCount: 1e300 }], total: 2 }))
    state.auto.templates = parseTemplates(JSON.stringify({ templates: [{ templateId: 't-1', name: 'build', stepCount: 2.7 }] }))
    state.auto.autopilot = parseAutopilot(JSON.stringify({ enabled: true, iterations: 1e300, maxIterations: -5, timeoutMinutes: 1e308, tasks: { completed: 1, total: 2, percent: 1e-7 }, taskSources: ['team-tasks'] }))
    state.view = 'automate'
    const screen = viewText({ state, nowMs: 5_000, columns: 160, act }, 'automate')
    const lines = screen.split('\n').filter(line => /steps?\b|iteration/.test(line))

    expect(state.auto.workflows?.map(row => row.steps)).toEqual([0, Number.MAX_SAFE_INTEGER])
    expect(state.auto.templates?.[0]?.steps).toBe(2)
    expect(state.auto.autopilot).toMatchObject({ iterations: Number.MAX_SAFE_INTEGER, maxIterations: 0, timeoutMinutes: Number.MAX_SAFE_INTEGER, done: 1, total: 2, percent: 0 })
    expect(lines.filter(line => HOSTILE.test(line))).toEqual([])
    expect(screen).toContain('tasks 1/2 (0%)')
  })

  it('autopilot percent is held to 0..100 and drawn whole', () => {
    const percentOf = (percent: unknown) => parseAutopilot(JSON.stringify({ enabled: false, tasks: { completed: 1, total: 3, percent } }))?.percent

    expect([percentOf(33.3333), percentOf(150), percentOf(-20), percentOf(1e308), percentOf('50')]).toEqual([33, 100, 0, 100, 0])
  })

  it('hooks_intelligence_stats counts are whole and non-negative, successRate and avgConfidence held to 0..1, and the live engine line draws plainly', () => {
    const intel = intelligenceProbe.parse(
      JSON.stringify({ sona: { trajectoriesTotal: 3, patternsLearned: 1e300, successRate: 5 }, modelRouter: { totalDecisions: 2.5, avgConfidence: -3 }, moe: { routingDecisions: -1e308 }, ewc: { consolidations: -2 } }),
    ) as Intelligence

    expect(intel).toMatchObject({ trajectories: 3, patterns: Number.MAX_SAFE_INTEGER, successRate: 1, routerDecisions: 2, routerConfidence: 0 })
    expect(intel.moeDecisions).toBeUndefined()
    expect(intel.ewcConsolidations).toBeUndefined()

    setLook('plain')
    const state = newState({})

    state.probes.set('intelligence', { value: intel, okAtMs: 4_000, error: null, errorAtMs: null, isRunning: false } as never)
    state.view = 'learning'
    // The SONA section is closed by default: toggled open, it draws the live engine line.
    state.sections.add('learning/learn-sona')
    const engine = viewText({ state, nowMs: 5_000, columns: 200, act }, 'learning').split('\n').find(line => line.includes('trajectories ·'))

    expect(engine).toBeDefined()
    expect(engine).not.toMatch(HOSTILE)
  })
})
