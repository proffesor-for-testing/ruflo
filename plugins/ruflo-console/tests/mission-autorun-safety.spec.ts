/**
 * Auto-run's safety (ADR-443): it never hands a task to Claude whose in-progress write failed, it stops after a bounded number of
 * hand-outs of one task, its spend guard never reads a frozen number, and a cap of "0" is no cap in Settings, in the guard and on
 * screen alike. Each case drives the real advance(), dispatch, probe scheduler and settings loader. Run with
 *   npx vitest run plugins/ruflo-console/tests/mission-autorun-safety.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { createController } from '../hooks/controller'
import { missionCostProbe } from '../hooks/data/cost-probes'
import { capText, type MissionCost } from '../hooks/data/mission-cost'
import type { TaskRecord } from '../hooks/data/parse'
import type { Host } from '../hooks/host'
import { advance, dispatchSpec, mcOf, missionActions, type MissionRecord } from '../hooks/mission-control'
import { capOf, isCapReached } from '../hooks/mission-guard'
import { createRunner } from '../hooks/runner'
import { loadAiPrefs, settingsOf } from '../hooks/settings'
import { newState, type State } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { missionCostRows } from '../hooks/views/mission-cost'

const ID = 'msn_0123456789abcdef01234567'
const out = (data: unknown) => `[INFO] Executing tool\nResult:\n${JSON.stringify(data)}\n`
type Calls = { runs: string[][]; prompts: string[]; timers: (() => void)[] }

/** A host whose tool runs answer per tool (exit code), whose `after` timers are held so a test can lapse them, and whose prompts are counted. */
function hostOf(calls: Calls, exitFor: (tool: string) => number): Host {
  return {
    run: async (argv: readonly string[]) => {
      calls.runs.push([...argv])
      const code = exitFor(argv[argv.indexOf('-t') + 1] ?? '')

      return { exitCode: code, stdout: code === 0 ? out({ success: true }) : '', stderr: code === 0 ? '' : 'ruflo: task store locked' }
    },
    storeGet: async () => undefined,
    storeSet: async () => undefined,
    invalidate: () => undefined,
    after: (_ms: number, fn: () => void) => (calls.timers.push(fn), { cancel: () => undefined }),
    submitPrompt: async (text: string) => void calls.prompts.push(text),
    fillPrompt: async () => true,
    runSlash: async () => undefined,
  } as unknown as Host
}

const task = (id: string, status: string): TaskRecord => ({ id, type: 'feature', description: '', status, assignedTo: [], tags: [] }) as TaskRecord

function world(exitFor: (tool: string) => number = () => 0) {
  const calls: Calls = { runs: [], prompts: [], timers: [] }
  const host = hostOf(calls, exitFor)
  const state: State = newState({})
  const mission: MissionRecord = {
    id: ID, objective: 'add a dark mode toggle', profile: 'feature', rigor: 'standard',
    tasks: [
      { id: 't1', title: 'Specify', phase: 'S', agent: 'specification', requirement: 'a spec', dependsOn: [], rufloTaskId: 'r1' },
      { id: 't2', title: 'Design', phase: 'A', agent: 'architecture', requirement: 'a design', dependsOn: ['t1'], rufloTaskId: 'r2' },
    ],
    acceptance: [{ id: 'ac', check: 'a spec exists' }], events: [], paused: false, cancelled: false, auto: true, createdAtMs: 1_000,
  }

  // The task store keeps reading both tasks pending: a failed in-progress write, or a store that has not caught up.
  state.snapshot = { tasks: [task('r1', 'pending'), task('r2', 'pending')], agents: [], claims: [], swarm: null, plugins: { missingFromClone: [] }, alerts: [] } as never
  mcOf(state).missions.set(ID, mission)
  mcOf(state).active = ID

  const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })

  return { calls, host, state, mission, actions: missionActions(state, host, runner) }
}

/** One refresh with Claude idle: advance(), let the dispatch settle, then lapse the 15 s in-flight guard. */
async function cycle(w: ReturnType<typeof world>, turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    advance(w.state, w.host)
    await new Promise(resolve => setTimeout(resolve, 0))
    for (const fire of w.calls.timers.splice(0)) fire()
  }
}

const reading = (usd: number, okAtMs: number, fromMs = 1_000) => ({ value: { usd, credits: null, unpriced: [], rows: 3, fromMs } satisfies MissionCost, okAtMs, error: null, errorAtMs: null, isRunning: false })
const types = (mission: MissionRecord) => mission.events.map(event => event.type)

describe('auto-run never re-dispatches a task whose in-progress write failed', () => {
  it('a failed task_update sends no prompt, records why, and stops after three tries', async () => {
    const w = world(tool => (tool === 'task_update' ? 1 : 0))

    await cycle(w, 6)

    expect(w.calls.prompts).toEqual([])
    expect(types(w.mission).filter(type => type === 'task.dispatch_failed')).toHaveLength(3)
    expect(types(w.mission)).not.toContain('task.dispatched')
    expect(w.calls.runs.filter(argv => argv.includes('task_update'))).toHaveLength(3)
    expect(w.mission.paused).toBe(true)
    expect(types(w.mission).at(-1)).toBe('auto.limit')
    expect(mcOf(w.state).last?.label).toMatch(/auto-run paused on task t1/)
  })

  it('the manual Run next path also refuses to send the prompt when the write failed', async () => {
    const w = world(tool => (tool === 'task_update' ? 1 : 0))

    w.mission.auto = false
    // What ▶ Run next asks for, confirmed: the same spec runs.
    await dispatchSpec(w.state, w.host, w.mission, w.mission.tasks[0]!, text => w.host.submitPrompt(text)).run?.()
    expect(w.calls.prompts).toEqual([])
    expect(mcOf(w.state).last).toMatchObject({ label: 'task t1 not handed over', ok: false })
  })
})

describe('auto-run hands out one task a bounded number of times', () => {
  it('a store that keeps reading the task ready gets at most three prompts, then the mission pauses with an event', async () => {
    const w = world()

    await cycle(w, 8)

    expect(w.calls.prompts.filter(text => text.includes('Task t1'))).toHaveLength(3)
    expect(w.mission.paused).toBe(true)
    expect(w.mission.events.at(-1)).toMatchObject({ type: 'auto.limit', taskId: 't1', status: 'paused' })
  })

  it('resuming is the person\'s go-ahead: the count starts again', async () => {
    const w = world()

    await cycle(w, 4)
    w.actions.resume()
    await cycle(w, 1)
    expect(w.calls.prompts).toHaveLength(4)
  })
})

describe('the spend guard never reads a frozen number', () => {
  it('with a cap, an hour-old reading below it holds auto-run (no prompt) and says why once', async () => {
    const w = world()

    settingsOf(w.state).ai.missionCapUsd = '1'
    w.state.probes.set('mission-cost', reading(0.4, Date.now() - 3_600_000))
    await cycle(w, 3)
    expect(w.calls.prompts).toEqual([])
    expect(types(w.mission).filter(type => type === 'cap.unknown')).toHaveLength(1)
    // A hold, not a pause: the next fresh reading lets it go on by itself.
    expect(w.mission.paused).toBe(false)
    w.state.probes.set('mission-cost', reading(0.4, Date.now()))
    await cycle(w, 1)
    expect(w.calls.prompts).toHaveLength(1)
  })

  it('with a cap, no reading for this mission holds auto-run; without a cap nothing is held', async () => {
    const capped = world()

    settingsOf(capped.state).ai.missionCapUsd = '5'
    capped.state.probes.set('mission-cost', reading(0.4, Date.now(), 999))
    await cycle(capped, 1)
    expect(capped.calls.prompts).toEqual([])

    const uncapped = world()

    await cycle(uncapped, 1)
    expect(uncapped.calls.prompts).toHaveLength(1)
  })

  it('an old reading already at the cap still pauses: spend inside a window only grows', () => {
    const w = world()

    settingsOf(w.state).ai.missionCapUsd = '1'
    w.state.probes.set('mission-cost', reading(1.2, Date.now() - 3_600_000))
    expect(isCapReached(w.state, w.mission)).toBe(true)
    advance(w.state, w.host)
    expect(w.mission.paused).toBe(true)
    expect(types(w.mission)).toContain('cap.reached')
  })

  it('the mission-cost probe runs while the active mission auto-runs, whatever page is in front and with the pane closed', async () => {
    const w = world()
    const runs: string[][] = []
    const host = new Proxy({}, {
      get: (_target, key) => {
        if (key === 'run') return async (argv: readonly string[]) => (runs.push([...argv]), { exitCode: 0, stdout: '{}', stderr: '' })
        if (key === 'after' || key === 'every') return () => ({ cancel: () => undefined })
        if (key === 'pluginRoot') return '/plugin'

        return () => Promise.resolve(undefined)
      },
    }) as unknown as Host

    w.state.cwd = '/work/app'
    w.state.view = 'overview'
    w.state.pane.isOpen = false
    w.state.snapshot = { ...w.state.snapshot, plugins: { missingFromClone: [], installed: [{ id: 'ruflo-cost-tracker@ruflo', name: 'ruflo-cost-tracker', marketplace: 'ruflo', version: '0.27.1', scope: 'user', installPath: '/p/ruflo-cost-tracker/x' }] } } as never

    const control = createController(w.state, host)

    await control.probe()
    expect(runs.some(argv => argv[1] === '/p/ruflo-cost-tracker/x/scripts/ledger.mjs' && argv.includes('--from'))).toBe(true)

    // Auto-run off: the probe belongs to the Missions page again.
    runs.length = 0
    w.mission.auto = false
    await control.probe(true)
    expect(runs.some(argv => argv[1]?.endsWith('/ledger.mjs'))).toBe(false)
    expect(missionCostProbe.views).toEqual(['missions'])
  })
})

describe('a mission cap of "0" is no cap everywhere, and never silently replaces a cap', () => {
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as never
  const flat = (node: unknown): string =>
    typeof node === 'string' || typeof node === 'number' ? String(node) : node === null || node === undefined || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(flat).join('') : flat((node as { props: { children?: unknown } }).props.children)
  const shown = (state: State, cost: MissionCost) => missionCostRows({ kit: { Box: element('Box'), Text: element('Text'), Button: element('Button') }, state, nowMs: 5, columns: 110, pictures: new Map(), act: {} } as unknown as Ctx, cost, capOf(state), 'ledger').map(flat)

  it('the Settings field refuses 0 and out-of-range caps (the cap stays as it was) and takes 0.01 to 10000', () => {
    for (const bad of ['0', '0.00', '0.001', '10000.01', '99999', '-1', '1e3', '$5', 'abc']) expect(capText(bad), bad).toBeNull()
    expect([capText(''), capText(' 0.01 '), capText('25'), capText('10000')]).toEqual(['', '0.01', '25', '10000'])
  })

  it('a stored "0" loads as no cap, so Settings, the guard and the Missions page all say none', async () => {
    const state = newState({})
    const host = { storeGet: async () => ({ missionCapUsd: '0' }), storeSet: async () => undefined, invalidate: () => undefined } as unknown as Host

    await loadAiPrefs(state, host)
    expect(settingsOf(state).ai.missionCapUsd).toBe('')
    expect(capOf(state)).toBeNull()
  })

  it('a "0" that reaches the prefs anyway is no cap to the guard and shows as none set, not $0.00', () => {
    const w = world()

    settingsOf(w.state).ai.missionCapUsd = '0'
    w.state.probes.set('mission-cost', reading(5, Date.now()))
    expect(capOf(w.state)).toBeNull()
    expect(isCapReached(w.state, w.mission)).toBe(false)
    const lines = shown(w.state, reading(5, 1).value)

    expect(lines.find(line => line.startsWith('cap') || line.includes('cap '))).toMatch(/none set/)
    expect(lines.join('\n')).not.toContain('$0.00')
  })
})
