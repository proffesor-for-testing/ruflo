/**
 * The hostile-number sweep, widened: every view, every mission tab, every collapsible section both ways, with every number in every
 * project file AND in every CLI probe's answer set to an edge value. Plus the parsers the sweep cannot reach (lab readers, the cost
 * ledger, evolve files, the agent stream), each held to a finite, bounded number.
 *   npx vitest run plugins/ruflo-console/tests/hostile-sweep.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { parseAgentdbMod } from '../hooks/data/agentdb-mod'
import { parseTrain } from '../hooks/data/automate'
import { finiteIn, usdOf } from '../hooks/data/bounds'
import { memoryProbe, namespacesProbe, PROBES, registryProbe, scoreProbe } from '../hooks/data/cli'
import { parseLedger as parseCostLedger } from '../hooks/data/cost-ledger'
import { parseGeneration, parseManifest, parseReceipt, parseServed } from '../hooks/data/evolve'
import { parseMissionCost } from '../hooks/data/mission-cost'
import { parseTasks } from '../hooks/data/parse'
import { parseResearch } from '../hooks/data/research'
import { messageOf } from '../hooks/data/xruv'
import { evolveLines } from '../hooks/evolve'
import { memLines } from '../hooks/memory-lines'
import { labLines } from '../hooks/mh-lab'
import { mcOf } from '../hooks/mission-control'
import type { McTab } from '../hooks/mission-types'
import { benchReader, metricsReader, reportReader } from '../hooks/perf'
import { roomOf } from '../hooks/room'
import { scanReader, SECURE_TEXT } from '../hooks/secure'
import { newState, VIEWS, type State } from '../hooks/state'
import { claudeParser, codexEvent, type Sink } from '../hooks/stream'
import { barText } from '../hooks/views/bar'
import { setLook } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'
import { act, AGENTDB_MOD_STATUS, AllFlipped, hostileStdout, isHostile, PROBE_OUT, snapshotWith, SWEEP } from './fixtures/hostile'
import { CLI_OUT } from './fixtures/ruflo-run'

const TABS: readonly McTab[] = ['plan', 'tasks', 'agents', 'evidence', 'record', 'loop']
const EDGES = [-1, 1e308, -1e308, 0.0000001, 12.3456789]

/** Every line of every view that matches the sweep, with sections at their defaults and then all flipped, on every mission tab. */
function sweepAll(state: State): { problems: string[]; screens: Map<string, string> } {
  const problems: string[] = []
  const screens = new Map<string, string>()

  for (const sections of [new Set<string>(), new AllFlipped()]) {
    state.sections = sections
    for (const tab of TABS) {
      mcOf(state).tab = tab
      for (const view of VIEWS) {
        state.view = view.id
        try {
          const screen = viewText({ state, nowMs: 5_000, columns: 200, act }, view.id)

          screens.set(`${view.id}/${tab}/${sections.size === 0 && !(sections instanceof AllFlipped) ? 'default' : 'flipped'}`, screen)
          for (const line of screen.split('\n')) if (SWEEP.test(line)) problems.push(`${view.id} (${tab}): ${line.trim().slice(0, 160)}`)
        } catch (error) {
          problems.push(`${view.id} (${tab}): threw ${String(error)}`)
        }
      }
    }
  }

  return { problems: [...new Set(problems)], screens }
}

/** Each probe fed its answer with every number set to `n`; returns the ids that parsed (a probe that refuses the whole answer is not drawn). */
function feedProbes(state: State, n: number): string[] {
  const fed: string[] = []

  for (const probe of PROBES) {
    const text = PROBE_OUT[probe.id]

    if (text === undefined) continue
    const value = probe.parse(hostileStdout(text, n) ?? text)

    if (value !== null && value !== undefined) {
      state.probes.set(probe.id, { value, okAtMs: 4_000, error: null, errorAtMs: null, isRunning: false } as never)
      fed.push(probe.id)
    }
  }

  return fed
}

describe('the widened sweep: files and probe answers, every view, tab and section', () => {
  it('the pattern catches what the round-3 review saw, and passes versions, dates, ids and plain decimals', () => {
    for (const bad of ['1e+302M entries', '[mem 1e+308]', '[mem -1.00]', 'last 1e+308 ms', '$-1.000', 'harnessFit 12.3456789', '12.3456789 B', 'unread 1e+308', '-1 entries'])
      expect(SWEEP.test(bad), bad).toBe(true)
    for (const good of ['ruflo v3.41.2', 'ruflo-agentdb 0.4.12', '2026-10-05 22:06', 'agent-1790903032181-97m25s', '$0.024', 'avg confidence 0.84', '9007199254.7M', 'harnessFit 42', 'sha256:f4f3e2e2'])
      expect(SWEEP.test(good), good).toBe(false)
  })

  it('the unchanged project and probe answers draw clean, so a finding below is the edge value and not the fixture', async () => {
    setLook('plain')
    const state = newState({})

    state.snapshot = await snapshotWith(Number.NaN, 'none')
    roomOf(state).mod = 'evil'
    for (const probe of PROBES) {
      const text = PROBE_OUT[probe.id]
      const value = text === undefined ? null : probe.parse(text)

      if (value !== null) state.probes.set(probe.id, { value, okAtMs: 4_000, error: null, errorAtMs: null, isRunning: false } as never)
    }
    const { problems, screens } = sweepAll(state)

    expect(problems).toEqual([])
    // The fixture reaches the screen: the mod's counters, the hive workers and the Memory Lab counts are all drawn.
    expect(screens.get('memory/plan/default')).toMatch(/attached\s+3 · 1 from cache · 1 skipped · 0 timed out · last 12 ms/)
    expect(screens.get('memory/plan/default')).toContain('◆ hello [mem 0.50]')
    expect(screens.get('overview/plan/default')).toMatch(/1 entries · 0 vectors/)
  })

  for (const n of EDGES) {
    it(`every number in every file and every probe answer set to ${n}: nothing hostile is drawn, and every view draws`, async () => {
      setLook('plain')
      const state = newState({})

      state.snapshot = await snapshotWith(n)
      roomOf(state).mod = 'evil'
      const fed = feedProbes(state, n)
      const { problems, screens } = sweepAll(state)

      expect(problems).toEqual([])
      // The answers reached the views: the Memory Lab and MetaHarness probes took the hostile answer rather than refusing it.
      expect(fed).toEqual(expect.arrayContaining(['memory', 'namespaces', 'metaharness', 'flywheel', 'audits', 'intelligence', 'registry']))
      expect(state.snapshot.agentdbMod).not.toBeNull()
      expect(state.snapshot.hiveAgents.length).toBeGreaterThan(0)
      for (const view of VIEWS) expect(screens.get(`${view.id}/record/flipped`)?.trim().length ?? 0, view.id).toBeGreaterThan(0)
    })
  }
})

describe('the AgentDB mod status file (ADR-445)', () => {
  const modWith = (patch: Record<string, unknown>) => parseAgentdbMod(JSON.stringify({ ...JSON.parse(AGENTDB_MOD_STATUS), ...patch }))

  it('counters are whole and bounded, lastMs whole, the write time a real date, and a score outside 0..1 is not drawn', () => {
    const mod = modWith({ attached: 1e308, skipped: -1, cached: 2.7, lastMs: 1e308, updatedMs: 1e300, recent: [{ source: 'a', score: 1e308, snippet: 'x' }, { source: 'b', score: -1, snippet: 'y' }, { source: 'c', score: 0.42, snippet: 'z' }] })

    expect(mod).toMatchObject({ attached: Number.MAX_SAFE_INTEGER, skipped: 0, cached: 2, lastMs: Number.MAX_SAFE_INTEGER, updatedMs: 0 })
    expect(mod?.recent.map(item => item.score)).toEqual([null, null, 0.42])
    expect(modWith({ lastMs: -5 })?.lastMs).toBeNull()
  })
})

describe('probe parsers hold every count and score', () => {
  it('memory stats, the namespace sample, harness scores, cost and registry limits', () => {
    expect(memoryProbe.parse(JSON.stringify({ backend: 'sqlite', entries: { total: 1e308, vectors: -1 }, unreadStore: { rows: 12.3456789 } }))).toMatchObject({ total: Number.MAX_SAFE_INTEGER, unread: 12 })
    expect(memoryProbe.parse(JSON.stringify({ backend: 'sqlite', entries: { vectors: -1 } }))?.vectors).toBeUndefined()
    expect(namespacesProbe.parse(JSON.stringify([{ key: 'k', namespace: 'n', size: 1e308 }, { key: 'j', namespace: 'n', size: -1 }]))?.entries?.map(entry => entry.size)).toEqual([Number.MAX_SAFE_INTEGER, undefined])
    const score = scoreProbe.parse(JSON.stringify({ harnessFit: 12.3456789, toolSafety: 1e308, estCostPerRunUsd: -1 }))

    expect(score?.dims.map(dim => dim.value)).toEqual([12, 100])
    expect(score?.costUsd).toBeUndefined()
    expect(scoreProbe.parse(JSON.stringify({ harnessFit: 1, estCostPerRunUsd: 1e308 }))?.costUsd).toBeUndefined()
    expect(scoreProbe.parse(JSON.stringify({ harnessFit: 1, estCostPerRunUsd: 0.024 }))?.costUsd).toBe(0.024)
    expect(registryProbe.parse(`Result:\n${JSON.stringify({ registration: { enabled: true, limits: { perHour: 1e308, burst: -1 } } })}`)?.registration?.limits).toBe(`perHour ${Number.MAX_SAFE_INTEGER}`)
  })

  it('usdOf and finiteIn keep a finite value inside their range and refuse the rest', () => {
    expect([usdOf(0), usdOf(0.024), usdOf(1e9), usdOf(1e9 + 1), usdOf(-0.01), usdOf(Number.NaN), usdOf('1')]).toEqual([0, 0.024, 1e9, undefined, undefined, undefined, undefined])
    expect([finiteIn(5, 0, 10), finiteIn(-1, 0, 10), finiteIn(11, 0, 10), finiteIn(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY)]).toEqual([5, undefined, undefined, undefined])
  })
})

describe('reports the sweep cannot reach', () => {
  it('the cost-tracker ledger: dollars, credits, cache ratio, message counts and savings', () => {
    const ledger = parseCostLedger(JSON.stringify({ totals: { usd: 1e308, credits: -5 }, byProvider: { anthropic: { usd: -1 } }, cache: { anthropic: { hitRatio: 7 } }, byModel: { 'anthropic|opus': { usd: 2.5 } }, tokens: { 'anthropic|opus': { messages: 1e308, output: -1 } }, findings: [{ title: 'cheaper', saving: 1e308, unit: 'usd' }] }))

    expect(ledger?.totals).toEqual({})
    expect(ledger?.providers[0]).toMatchObject({ cost: {}, hitRatio: 1 })
    expect(ledger?.models[0]).toMatchObject({ cost: { usd: 2.5 }, messages: Number.MAX_SAFE_INTEGER, output: 0 })
    expect(ledger?.findings[0]?.saving).toBeNull()
  })

  it('a mission’s spend window and a research record', () => {
    expect(parseMissionCost(JSON.stringify({ rows: 1e308, totals: { usd: 1e308, credits: 1e308 } }))).toMatchObject({ rows: Number.MAX_SAFE_INTEGER, usd: null, credits: null })
    expect(parseMissionCost(JSON.stringify({ rows: -3, totals: {} }))).toMatchObject({ rows: 0, usd: 0 })
    expect(parseResearch(JSON.stringify({ version: 1, records: [{ question: 'q', spentUsd: 1e308, capUsd: -1 }] }))?.[0]).toMatchObject({ spentUsd: null, capUsd: null })
  })

  it('evolve files: epochs, generations, fix counts and lift', () => {
    expect(parseGeneration(JSON.stringify({ generation: 1e308 }))?.generation).toBe(Number.MAX_SAFE_INTEGER)
    expect(parseGeneration(JSON.stringify({ generation: -1 }))).toBeNull()
    expect(parseServed(JSON.stringify({ fromGeneration: -1e308 }))).toEqual({})
    expect(parseServed(JSON.stringify({ fromGeneration: 1e308 }))).toEqual({ fromGeneration: Number.MAX_SAFE_INTEGER })
    expect(parseReceipt(JSON.stringify({ payload: { receiptId: 'sha256:f4f3e2e2', statistics: { relativeLift: 1e308 } } }))).not.toHaveProperty('lift')
    expect(parseReceipt(JSON.stringify({ payload: { receiptId: 'sha256:f4f3e2e2', statistics: { relativeLift: -2 } } }))).not.toHaveProperty('lift')
    expect(parseReceipt(JSON.stringify({ payload: { receiptId: 'sha256:f4f3e2e2', statistics: { relativeLift: -0.05 } } }))?.lift).toBe(-0.05)
    expect(parseManifest(JSON.stringify({ manifest: { summary: { totalFixes: 12.3456789 } } }), 'linux')?.fixes).toBe(12)
  })

  it('a neural train table and a swarm message time', () => {
    const train = (epochs: string, loss: string, time: string) => parseTrain(`| Pattern Type | coordination |\n| Epochs | ${epochs} |\n| Final Loss | ${loss} |\n| Total Time | ${time} |`, 1)

    expect(train('1e308', '1e308', '1e308s')).toMatchObject({ epochs: Number.MAX_SAFE_INTEGER })
    expect(train('1e308', '1e308', '1e308s')).not.toHaveProperty('loss')
    expect(train('1e308', '1e308', '1e308s')).not.toHaveProperty('seconds')
    expect(train('-1', '0.2', '3.5s')).toBeNull()
    const message = messageOf({ pubkey: 'a'.repeat(64), created_at: 1e300, content: 'hi' })

    expect(message).not.toBeNull()
    expect(message).not.toHaveProperty('atMs')
    expect(messageOf({ pubkey: 'a'.repeat(64), created_at: 1_790_000_000 })?.atMs).toBe(1_790_000_000_000)
  })

  it('the agent stream: a hostile cost, token count or exit code never reaches the terminal', () => {
    const notes: { costUsd?: number; tokens?: number }[] = []
    const lines: string[] = []
    const sink: Sink = { line: (_kind, text) => lines.push(text), type: () => undefined, done: note => notes.push(note), session: () => undefined }
    const claude = claudeParser()

    claude({ type: 'result', total_cost_usd: 1e308 }, sink)
    claude({ type: 'result', total_cost_usd: -1 }, sink)
    codexEvent({ type: 'turn.completed', usage: { input_tokens: 1e308, output_tokens: 1e308 } }, sink)
    codexEvent({ type: 'item.completed', item: { type: 'command_execution', exit_code: 1e308, aggregated_output: '' } }, sink)

    expect(notes.slice(0, 2)).toEqual([{}, {}])
    expect(notes[2]?.tokens).toBe(Number.MAX_SAFE_INTEGER)
    expect(lines.filter(line => SWEEP.test(line))).toEqual([])
  })
})

describe('lab readers a person runs', () => {
  it('Memory Lab scores and vectors, and performance metrics, draw n/a for a hostile number', () => {
    expect(memLines('mem-search', JSON.stringify({ searchTime: 1e308, results: [{ key: 'k', namespace: 'n', score: 1e308 }, { key: 'j', namespace: 'n', score: -1e308, source: 12.3456789 }] })).filter(line => SWEEP.test(line))).toEqual([])
    expect(memLines('mem-get', JSON.stringify({ key: 'k', namespace: 'n', embedding: [1e308, 1e308, 0.5] })).filter(line => SWEEP.test(line))).toEqual([])
    const state = newState({})
    const metrics = metricsReader(JSON.stringify({ memory: { heapUsed: 1e308, heapTotal: -1, rss: 12.3456789, systemPercent: 1e308 }, cpu: { loadAverage: [1e308, -1, 0.5] }, latency: { avgMs: 1e308 } }), '', state)
    const report = reportReader(JSON.stringify({ current: { cpu: { usage: 1e308 }, latency: { avg: -1e308, p50: 12.3456789 } }, history: [{ latency: { avg: 1e308 } }] }), '', state)

    expect([...metrics, ...report].filter(line => SWEEP.test(line))).toEqual([])
    expect(metrics[0]).toContain('event-loop latency n/a · heap n/a of n/a')
    expect(metrics[1]).toBe('system memory n/a · load 0.50')
  })

  it('every captured CLI answer, every number set to an edge value, read by the lab and Memory Lab readers: no exponent, long fraction or hostile count', () => {
    const problems: string[] = []

    for (const n of EDGES) {
      for (const [key, text] of Object.entries(CLI_OUT)) {
        const hostile = hostileStdout(text, n) ?? text

        // The generic dump prints a field of a shape it does not know as the tool wrote it, sign included (`alpha: -1`): only that is let through.
        for (const line of [...labLines(key, hostile), ...memLines(key, hostile)]) if (SWEEP.test(line) && !/^\s*[\w.]+: -\d+$/.test(line)) problems.push(`${key} (${n}): ${line}`)
      }
    }

    expect([...new Set(problems)]).toEqual([])
    expect(labLines('mh-redblue-mock', hostileStdout(CLI_OUT['mh-redblue-mock'] as string, -1) as string)[0]).toBe('tests n/a · failures n/a · critical n/a · high n/a · med n/a · low n/a')
  })

  it('a benchmark table prints its numbers bounded', () => {
    const lines = benchReader(JSON.stringify({ suite: 'core', iterations: 1e308, totalTime: 12.3456789, results: [{ operation: 'store', mean: -1e308, p95: 1e-7, p99: 0.25, improvement: '2x' }] }), '', newState({}))

    expect(lines.filter(line => SWEEP.test(line))).toEqual([])
    expect(lines[1]).toContain('p99 0.25')
  })

  it('a real benchmark, whose times the CLI prints as text with a unit, keeps them (performance.ts printJson)', () => {
    const real = { suite: 'wasm', iterations: 100, totalTime: '1.23s', results: [{ operation: 'Flash Attention', mean: '0.45ms', p95: '0.61ms', p99: '0.80ms', improvement: '2.10x' }, { operation: 'SONA', mean: 'N/A', p95: 'N/A', p99: 'N/A', improvement: 'N/A' }] }
    const lines = benchReader(JSON.stringify(real), '', newState({}))

    expect(lines[0]).toBe('suite wasm · 100 iterations · 1.23s')
    expect(lines[1]).toContain('mean 0.45ms · p95 0.61ms · p99 0.80ms · 2.10x')
    expect(lines[2]).toContain('mean N/A')
    expect(benchReader(JSON.stringify({ ...real, totalTime: '\u001b]8;;x\u0007s\u202e1' }), '', newState({}))[0]).not.toMatch(/[\u001b\u202e]/)
  })
})

describe('round 4: the readers the round-4 review found drawing raw', () => {
  it('a hostile `security scan` summary: the counts are bounded in the result, the status band and the Security meter', () => {
    setLook('plain')
    const state = newState({})
    const lines = scanReader(JSON.stringify({ type: 'code', depth: 'quick', summary: { critical: 1e308, high: 1e308, medium: -1, low: 12.3456789, total: 1e308 }, findings: [] }), '', state)

    state.view = 'secure'
    const drawn = [...lines, barText(state, 5_000), ...viewText({ state, nowMs: 5_000, columns: 200, act }, 'secure').split('\n')]

    expect(drawn.filter(line => SWEEP.test(line))).toEqual([])
    expect(barText(state, 5_000)).toContain(`🔒 ${2 * Number.MAX_SAFE_INTEGER} high or critical`)
  })

  it('a threat confidence outside 0..1 from `security defend` is held to 0..100%', () => {
    const read = SECURE_TEXT.find(entry => entry.id === 'aid-check')?.read
    const lines = read?.(JSON.stringify({ safe: false, threats: [{ severity: 'high', type: 'injection', confidence: 1e308, description: 'x' }, { severity: 'low', type: 'pii', confidence: -1, description: 'y' }] }), '', newState({})) ?? []

    expect(lines.slice(1)).toEqual(['[high] injection 100% · x', '[low] pii 0% · y'])
  })

  it('Self-Evolution: the serving epoch of the ledger and of each promotion is a bounded count', () => {
    const ledger = evolveLines(newState({}), 'evolve-ledger', `Result:\n${JSON.stringify({ state: { servingEpoch: 1e308, activeChampionRef: null, receiptStates: {} }, ledger: { valid: true, errors: [], commits: 1, head: 'sha256:00' } })}`, '', 1)
    const history = evolveLines(newState({}), 'evolve-history', JSON.stringify({ commits: [{ servingEpoch: -1, baselineRef: 'b', candidateId: 'c', receiptId: 'r', proposer: 'local' }] }), '', 1)

    expect([...ledger, ...history].filter(line => SWEEP.test(line))).toEqual([])
    expect(history[0]).toMatch(/^epoch \? · /)
  })

  it('MetaHarness genome: the meta fields are text, so a number there reads n/a', () => {
    const lines = labLines('mh-genome', JSON.stringify({ valid: true, errors: [], genome: { meta: { id: 'g1', parent: -1, mutated: 1e308 }, components: { a: 1 } } }))

    expect(lines[1]).toBe('genome g1 (parent n/a, mutated n/a)')
  })

  it('a completed task’s result object: its numbers are bounded, a signed one keeps its key', () => {
    const task = parseTasks(JSON.stringify({ tasks: { 't-1': { taskId: 't-1', status: 'completed', result: { tests: 1e308, coverage: 12.3456789, delta: -1 } } } }))[0]

    expect(task?.resultText).toBe('tests: n/a · coverage: 12.345679 · delta: -1')
    expect(isHostile(task?.resultText ?? '')).toBe(false)
  })
})
