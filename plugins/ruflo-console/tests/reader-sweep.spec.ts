/**
 * The reader sweep: every command the palette can run is classified, and every one whose output a reader turns into lines (a result
 * panel's `read`/`lines`, the lab's generic reading, a board's `onOutput`) is fed hostile numbers two ways:
 *   1. every captured CLI output and project file in tests/fixtures, every JSON number replaced by an edge value;
 *   2. a document of the reader's own keys (learned from the reader by recording what it reads, tests/fixtures/reader-fuzz.ts), as a
 *      plain object, a top-level array and an `mcp exec` wrapper, every number an edge value.
 * After each reader, the status band (`/ruflo status`) and every view are drawn too, so what a reader keeps in the state is swept.
 * A palette entry that cannot be built in the test state is in UNSWEPT with its reason, and the test fails if that list drifts.
 *   npx vitest run plugins/ruflo-console/tests/reader-sweep.spec.ts
 */
import { beforeAll, describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import { PROBES } from '../hooks/data/cli'
import { paletteEntries, type PaletteEntry } from '../hooks/palette'
import { roomOf } from '../hooks/room'
import { resultLines } from '../hooks/result-lines'
import { sandboxLines } from '../hooks/sandbox'
import { newState, VIEWS, type State } from '../hooks/state'
import { barText } from '../hooks/views/bar'
import { setLook } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'
import { act, AllFlipped, hostileStdout, isHostile, PROBE_OUT, snapshotWith } from './fixtures/hostile'
import { AUTO_OUT } from './fixtures/automate'
import { EVOLVE_OUT } from './fixtures/evolve'
import { MEM_OUT } from './fixtures/memory'
import { hostileOf, learnShape, type Shape, type Wrap } from './fixtures/reader-fuzz'
import { CLI_OUT } from './fixtures/ruflo-run'
import { VEC_OUT } from './fixtures/vector'

const NOW = 5_000
const EDGES = [-1, 1e308, -1e308, 0.0000001, 12.3456789]
const WRAPS: readonly Wrap[] = ['plain', 'array', 'mcp']

/** Texts tried, in order, on an entry that takes text, until one passes its rule. */
const TEXTS = ['hello world', 'deploy', 'notes alpha the value', 'alpha | beta', 'src causes dst', 'swarm.topology mesh', 'docs/x.json', '.claude-flow/x.rvf', '.claude-flow/x.rvf 384', './file.js', 'lodash', 'agent-1790903032181-97m25s', 'title :: content', 'a b', '384', 'https://example.com', '@e1', 'ruflo-core', '5', 'on', 'coordination 10', `${'a'.repeat(64)} member`, `prv:0123456789abcdef ${'a'.repeat(64)}`, '']

const NOT_SEATED = 'needs a seated ruflo-mods engine (the cost budget setter): the console builds no spec without it'
const NOT_WIRED = 'needs the controller’s wiring (a host): its spec runs in-process (`run`), so there is no CLI output for a reader'
const NO_WORKER = 'needs a registered hive worker to vote as; a vote is a write whose outcome line is the only output (no reader)'
const TYPES = 'types the command into the AI terminal for the person to run: its output goes to the terminal, not to a reader'
const NA = 'never runs: the entry says n/a (no CLI verb, MCP-only, or would open a browser)'
const RULE = 'takes text in a form no sample in TEXTS passes'
const ANATOLE = 'Project Anatole: sends /protector through the host (runSlash), not a CLI argv, so with no host wired no spec is built; run and replay show the mod’s answer as written (textLines), and the numbers the section draws come from the mod’s files, which tests/hostile-sweep.spec.ts sweeps'
const TEXT = 'reads the CLI’s text, not JSON (doctor’s check rows, a table, a tmux screen): it shows those lines as written, so no number of its own reaches the screen'

/** Palette entries the sweep cannot build a spec for in its state, and why. The test fails if this differs from what it finds. */
/** The captured CLI output in tests/fixtures for each reader that has one (the rest are fed only their learned documents). */
const CAPTURED: Readonly<Record<string, readonly string[]>> = {
  'mh-score': [CLI_OUT['mh-score'] as string],
  'mh-mcp-scan': [CLI_OUT['mh-mcp-scan'] as string],
  'mh-threat': [CLI_OUT['mh-threat'] as string],
  'mh-redblue-mock': [CLI_OUT['mh-redblue-mock'] as string],
  'mh-gepa-render': [CLI_OUT['mh-gepa-render'] as string],
  'mh-receipts': [CLI_OUT['mh-flywheel'] as string, EVOLVE_OUT.receipts],
  'nn-intel': [CLI_OUT.intel as string],
  'x-bbs-peers': [CLI_OUT['bbs-peers'] as string, PROBE_OUT.peers as string],
  'x-channels': [CLI_OUT.channels as string, PROBE_OUT.channels as string],
  'x-registry': [PROBE_OUT.registry as string],
  'x-roster': [PROBE_OUT.roster as string],
  'mem-stats': [CLI_OUT['memory-stats'] as string, MEM_OUT.stats as string],
  'mem-list': [CLI_OUT['memory-list'] as string, MEM_OUT.list as string],
  'mem-retrieve': [MEM_OUT.retrieve as string],
  'mem-search': [MEM_OUT.search as string],
  'mem-unified': [MEM_OUT.unified as string],
  'mem-health': [MEM_OUT.health as string],
  'mem-delete': [MEM_OUT.deleteMissing as string],
  'mem-store': [MEM_OUT.stored as string],
  'vec-hooks-route': [VEC_OUT.route],
  'vec-identity-show': [VEC_OUT.identityShow, VEC_OUT.identityNone],
  'evolve-ledger': [EVOLVE_OUT.statusEmpty, EVOLVE_OUT.statusBroken],
  'evolve-receipts': [EVOLVE_OUT.receipts],
  'evolve-history': [EVOLVE_OUT.history, EVOLVE_OUT.historyEmpty],
  'evolve-policy': [EVOLVE_OUT.policy],
  'evolve-gate': [EVOLVE_OUT.gate],
  'evolve-witness-linux': [EVOLVE_OUT.verify],
  'auto-wf-list': [AUTO_OUT['workflow-list'] as string, AUTO_OUT['workflow-empty'] as string],
  'auto-wf-templates': [AUTO_OUT['template-list'] as string],
  'auto-ses-list': [AUTO_OUT['session-list'] as string],
  'auto-cfg-list': [AUTO_OUT['config-list'] as string],
  'auto-ap-status': [AUTO_OUT['autopilot-status'] as string],
  'nn-route': [AUTO_OUT['hooks-route'] as string],
}

const UNSWEPT: Readonly<Record<string, string>> = {
  'cost-budget-1': NOT_SEATED,
  'cost-budget-5': NOT_SEATED,
  'cost-budget-10': NOT_SEATED,
  'cost-budget-25': NOT_SEATED,
  'cost-budget': NOT_SEATED,
  'claim-handoff': 'the picked agent already holds the claim in the captured project; a handoff is a write with no reader',
  'claim-steal': 'no claim in the captured project is marked stealable by the picked agent; a steal is a write with no reader',
  'vote-yes-proposal-1790903321981-23aov7': NO_WORKER,
  'vote-no-proposal-1790903321981-23aov7': NO_WORKER,
  'hive-vote-yes': NO_WORKER,
  'hive-vote-no': NO_WORKER,
  'mh-gepa-analyze': TYPES,
  'mh-learn-run': TYPES,
  'x-bbs-serve': TYPES,
  'x-invite': 'an invite code is a bearer secret: the row types the command into the terminal, never into a reader',
  'x-unregister': NA,
  'auto-worker-cancel': NA,
  'vec-rvf-delete': NA,
  'vec-sql': NA,
  'vec-cypher': NA,
  'vec-sparql': NA,
  'vec-decompile-witness': NA,
  'vec-edge-dashboard': NA,
  'vec-identity-generate': 'waits for ▸ SHOW to find no pi key (a gate on a live read), so no spec is built in the test state',
  'skills-update': NOT_WIRED,
  'skills-restore': NOT_WIRED,
  'skills-sync': NOT_WIRED,
  'skills-find': NOT_WIRED,
  'mission-goal': NOT_WIRED,
  'mission-status': NOT_WIRED,
  'mission-create': NOT_WIRED,
  'mission-next': NOT_WIRED,
  'mission-pause': NOT_WIRED,
  'mission-resume': NOT_WIRED,
  'mission-cancel': NOT_WIRED,
  'mission-aside': NOT_WIRED,
  'mission-guide': NOT_WIRED,
  'mission-auto': NOT_WIRED,
  'mission-research': NOT_WIRED,
  ask: NOT_WIRED,
  'ask-aside': NOT_WIRED,
  'catalog-install': RULE,
  'catalog-uninstall': RULE,
  'catalog-enable': RULE,
  'catalog-disable': RULE,
  'catalog-update': RULE,
  'settings-set': RULE,
  'x-bbs-peer-add': RULE,
  'vec-rvf-ingest': RULE,
  'vec-rvf-derive': RULE,
  'anatole-run': ANATOLE,
  'anatole-replay': ANATOLE,
  'anatole-mode': ANATOLE,
  'anatole-rule': ANATOLE,
  'anatole-ack': ANATOLE,
  'anatole-allow': ANATOLE,
  'anatole-reset': ANATOLE,
  'anatole-ack-a1': `${ANATOLE} (one entry per open alert in tests/fixtures/hostile.ts)`,
  'anatole-allow-abcdef012345': `${ANATOLE} (one entry per open alert's fingerprint)`,
  'aid-stats': TEXT,
  'sec-audit': TEXT,
  'sec-cve': TEXT,
  'sec-secrets': TEXT,
  'sec-threats': TEXT,
  'perf-profile': TEXT,
  'doc-all': TEXT,
  'doc-fix': TEXT,
  'doc-aidefence': TEXT,
  'doc-claude': TEXT,
  'doc-config': TEXT,
  'doc-daemon': TEXT,
  'doc-disk': TEXT,
  'doc-git': TEXT,
  'doc-helpers': TEXT,
  'doc-mcp': TEXT,
  'doc-memory': TEXT,
  'doc-mods': TEXT,
  'doc-node': TEXT,
  'doc-npm': TEXT,
  'dt-sb-list': `${TEXT}; its one parsed number, the window count, has its own test below`,
  'dt-sb-new': TEXT,
  'dt-sb-send': TEXT,
  'dt-sb-capture': TEXT,
  'dt-sb-kill': TEXT,
}

/** A state with every gate the sweep can open: the captured project, two stored audits, the witness manifests, the admin token. */
async function seeded(): Promise<State> {
  const state = newState({})

  state.snapshot = await snapshotWith(Number.NaN, 'none')
  roomOf(state).mod = 'evil'
  for (const probe of PROBES) {
    const text = PROBE_OUT[probe.id]
    const value = text === undefined ? null : probe.parse(text)

    if (value !== null && value !== undefined) state.probes.set(probe.id, { value, okAtMs: 4_000, error: null, errorAtMs: null, isRunning: false } as never)
  }
  state.evolve.files = { flywheel: null, receipts: null, generations: null, served: null, policy: null, manifests: (['linux', 'macos', 'windows'] as const).map(os => ({ os })), hasRgiDb: false, readAtMs: 1 } as never
  state.xruv.hasAdminToken = true

  return state
}

type Classified = { readers: { id: string; spec: ActionSpec }[]; plain: string[]; unbuilt: string[] }

/** The palette's entries, each built (a text entry with the first sample it accepts) and sorted into readers, plain runs and unbuilt. */
function classify(entries: readonly PaletteEntry[]): Classified {
  const out: Classified = { readers: [], plain: [], unbuilt: [] }

  for (const entry of entries) {
    const run = entry.run
    let spec: ActionSpec | null = null

    if (run.kind === 'spec') spec = run.spec
    else if (run.kind === 'text') for (const text of TEXTS) if ((spec = run.make(text)) !== null) break
    if (run.kind !== 'spec' && run.kind !== 'text') continue
    if (spec === null) out.unbuilt.push(entry.id)
    else if (spec.lab !== undefined || spec.read !== undefined || spec.lines !== undefined || spec.onOutput !== undefined) out.readers.push({ id: entry.id, spec })
    else out.plain.push(entry.id)
  }

  return out
}

/** What a reader drew for one stdout, then (with `draw`) the band and every view, sections closed and open: the lines the sweep flags. */
function feed(state: State, id: string, spec: ActionSpec, stdout: string, draw: boolean): string[] {
  const problems: string[] = []
  const check = (where: string, lines: readonly string[]) => {
    for (const line of lines) if (isHostile(line)) problems.push(`${id} → ${where}: ${line.trim().slice(0, 160)}`)
  }

  try {
    check('result', resultLines(spec, stdout, '', true))
    spec.onOutput?.(stdout)
  } catch (error) {
    problems.push(`${id} → threw ${String(error)}`)
  }
  if (!draw) return problems
  check('band', [barText(state, NOW)])
  for (const sections of [new Set<string>(), new AllFlipped()]) {
    state.sections = sections
    for (const view of VIEWS) {
      state.view = view.id
      try {
        check(view.id, viewText({ state, nowMs: NOW, columns: 200, act }, view.id).split('\n'))
      } catch (error) {
        problems.push(`${id} → ${view.id} threw ${String(error)}`)
      }
    }
  }

  return problems
}

/** Each reader's learned shapes, one per wrap it reads into (a wrap it reads no key of is a text it shows as written, not JSON). */
async function learnAll(): Promise<{ state: State; classified: Classified; shapes: Map<string, Shape[]> }> {
  const state = await seeded()
  const classified = classify(paletteEntries(state, NOW))
  const shapes = new Map<string, Shape[]>()

  for (const { id, spec } of classified.readers) shapes.set(id, WRAPS.map(wrap => learnShape(stdout => feed(state, id, spec, stdout, false), wrap)).filter(shape => shape.keys > 0))

  return { state, classified, shapes }
}

describe('the reader sweep: every palette reader, fed hostile numbers in its own keys and in its captured outputs', () => {
  let learned: Awaited<ReturnType<typeof learnAll>>

  beforeAll(async () => {
    learned = await learnAll()
  }, 120_000)

  it('the catalog is fully classified: an entry not built, or a reader that reads no JSON key, is exactly UNSWEPT', () => {
    const { classified, shapes } = learned
    const textOnly = classified.readers.filter(reader => (shapes.get(reader.id) ?? []).length === 0).map(reader => reader.id)
    const swept = classified.readers.length - textOnly.length

    expect([...classified.unbuilt, ...textOnly].sort()).toEqual(Object.keys(UNSWEPT).sort())
    expect(swept).toBeGreaterThan(200)
    for (const id of ['sec-scan-quick', 'aid-check', 'perf-metrics', 'mh-genome', 'mh-trend', 'evolve-ledger', 'evolve-witness-linux', 'mem-search', 'auto-ap-status', 'x-hub', 'nn-intel'])
      expect(shapes.get(id)?.length ?? 0, id).toBeGreaterThan(0)
    // Every captured fixture named for a reader is one: a renamed entry cannot leave its captured output unfed.
    for (const id of Object.keys(CAPTURED)) expect(shapes.get(id)?.length ?? 0, id).toBeGreaterThan(0)
  })

  it('the pattern: hostile forms match; a keyed or lone signed value, a version, a date and a plain decimal do not', () => {
    for (const bad of ['1e+308 entries', '-1 entries', 'parent -1', '[mem -1.00]', '$-1.000', 'Infinity%', 'NaN', '12.3456789 MB', 'serving epoch 1e+308', 'mean -1 · p95 -1'])
      expect(isHostile(bad), bad).toBe(true)
    for (const good of ['delta: -1', 'alpha: -1, -2', 'swarm.maxAgents = -1 (stored)', '{"delta":-1}', '  -1,', 'ruflo v3.41.2', '2026-10-05 22:06', 'agent-1790903032181-97m25s', 'coverage: 12.346'])
      expect(isHostile(good), good).toBe(false)
  })

  it('the shape learner finds a reader’s keys from its code: the scan reader asks for summary.critical and findings[].severity', () => {
    const doc = JSON.parse(hostileOf(learned.shapes.get('sec-scan-quick')?.[0] as Shape, 7)) as { summary?: unknown; findings?: { severity?: unknown }[] }

    expect(doc.summary).toMatchObject({ critical: 7, total: 7 })
    expect(doc.findings?.[0]).toMatchObject({ severity: 7 })
  })

  it('clean control: the captured outputs and the learned documents with a plain number draw nothing the sweep flags', () => {
    const { state, classified, shapes } = learned
    const problems: string[] = []

    for (const { id, spec } of classified.readers) {
      for (const text of CAPTURED[id] ?? []) problems.push(...feed(state, id, spec, text, false))
      for (const shape of shapes.get(id) ?? []) problems.push(...feed(state, id, spec, hostileOf(shape, 3), false))
    }

    expect([...new Set(problems)]).toEqual([])
  })

  for (const n of EDGES) {
    it(`every swept reader, every number ${n}: no hostile number in the result, the band or any view, and nothing throws`, () => {
      setLook('plain')
      const { state, classified, shapes } = learned
      const problems: string[] = []

      for (const { id, spec } of classified.readers) {
        for (const text of CAPTURED[id] ?? []) problems.push(...feed(state, id, spec, hostileStdout(text, n) ?? text, true))
        for (const shape of shapes.get(id) ?? []) problems.push(...feed(state, id, spec, hostileOf(shape, n), true))
      }

      expect([...new Set(problems)]).toEqual([])
    }, 120_000)
  }
})

describe('a text reader that parses a number', () => {
  it('tmux list-sessions: a window count that is not a small whole number reads n/a', () => {
    const lines = sandboxLines(['ruflo-sb-a|1e308|1790000000', 'ruflo-sb-b|-1|1790000000', 'ruflo-sb-c|2|1790000000'].join('\n'), '', true)

    expect(lines.filter(isHostile)).toEqual([])
    expect(lines.map(line => line.split(' · ')[1])).toEqual(['n/a windows', 'n/a windows', '2 windows'])
  })
})
