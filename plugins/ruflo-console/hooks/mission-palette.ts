/** Palette entries for Mission Control, so `/ruflo run mission-next` and `/ruflo plan <goal>` work headless; a write or a turn still asks. */
import type { ActionSpec } from './actions'
import { plain } from './data/parse'
import { blocksCreate } from './mission-options'
import { activeMission, cancelSpec, createSpec, dispatchSpec, mcOf, missionWired, nextTask, setGoal } from './mission-control'
import type { PaletteEntry } from './palette'
import type { State } from './state'

/** A billed turn, in the words the confirm card shows and the class reader knows (model-tools.ts). */
const TURN = 'Starts a Claude Code turn (billed as any turn is).'

export function missionPalette(state: State): PaletteEntry[] {
  const wired = missionWired(state)
  // A local action: the person's click is the consent, so it runs at once for them. What it does for Claude is `declared` (ADR-444 levels):
  // a wrapper that starts a turn, turns on unattended hand-offs or writes the ledger is not a read, and goes through Claude's gate.
  const local = (label: string, run: () => void, more: Partial<ActionSpec> = {}): ActionSpec | null => (wired === undefined ? null : { label, args: [], expect: label, isReadOnly: true, run: async () => run(), ...more })
  const why = 'open Mission Control (the Missions view) first'
  const spec = (make: () => ActionSpec | null) => ({ kind: 'spec' as const, spec: wired === undefined ? null : make(), why })
  const text = (keyword: string, make: (text: string) => ActionSpec | null) => ({ kind: 'text' as const, keyword, make: (value: string) => (wired === undefined ? null : make(value)), why: () => why })
  const tasks = () => state.snapshot?.tasks ?? []
  // on or off in any case; anything else is refused, never read as off (a typo must not stop or start auto-run silently).
  const autoSpec = (value: string): ActionSpec | null => {
    const word = value.trim().toLowerCase()

    if (word !== 'on' && word !== 'off') return null

    return word === 'on'
      ? local('turn auto-run on', () => wired?.actions.auto(true), { declared: 'spend', note: `hands each next ready task to Claude without asking, up to the mission cap. ${TURN}` })
      : local('turn auto-run off', () => wired?.actions.auto(false), { declared: 'write' })
  }

  return [
    { id: 'mission-goal', group: 'missions', label: 'mission-goal <goal>: plan a goal as a SPARC goal-oriented plan (nothing is written)', run: text('mission-goal', value => local('plan the goal', () => setGoal(state, value), { declared: 'write', levelOnly: true })) },
    { id: 'mission-status', group: 'missions', label: 'mission status: progress, each task’s status, what is next', run: spec(() => local('mission status', () => undefined)) },
    { id: 'mission-create', group: 'missions', label: 'create the mission and its tasks from the planned goal (asks first)', run: spec(() => (wired === undefined || blocksCreate(mcOf(state).screen) ? null : createSpec(state, wired.host, () => undefined))) },
    {
      id: 'mission-next',
      group: 'missions',
      label: 'hand the next ready task to Claude (asks first: it starts a turn)',
      run: spec(() => {
        const mission = activeMission(state)
        const task = mission === null ? null : nextTask(mission, tasks())

        return wired === undefined || mission === null || task === null ? null : dispatchSpec(state, wired.host, mission, task, text => wired.host.submitPrompt(text))
      }),
    },
    { id: 'mission-pause', group: 'missions', label: 'pause: no more tasks are handed out', run: spec(() => local('pause the mission', () => wired?.actions.pause(), { declared: 'write' })) },
    // With auto-run on, resuming hands out billed turns again with nobody asked: that is a spend.
    { id: 'mission-resume', group: 'missions', label: 'resume handing out tasks', run: spec(() => local('resume the mission', () => wired?.actions.resume(), activeMission(state)?.auto === true ? { declared: 'spend', note: `auto-run is on: each next ready task is handed to Claude without asking. ${TURN}` } : { declared: 'write' })) },
    { id: 'mission-cancel', group: 'missions', label: 'cancel the mission and its open tasks (asks first)', run: spec(() => { const mission = activeMission(state); return wired === undefined || mission === null ? null : cancelSpec(state, wired.host, mission, tasks()) }) },
    { id: 'mission-aside', group: 'missions', label: 'mission-aside <question>: /btw beside the running task', run: text('mission-aside', value => local('ask aside', () => wired?.actions.aside(value), { declared: 'spend', shows: `/btw ${plain(value, 200)}`, note: TURN })) },
    // Guide and research raise their own ask once AIDefence has screened the text; that ask is gated when it lands (runner.ts).
    { id: 'mission-guide', group: 'missions', label: 'mission-guide <instruction>: a visible instruction to Claude (screened, asks first)', run: text('mission-guide', value => local('guide Claude', () => wired?.actions.guide(value), { declared: 'spend', levelOnly: true })) },
    {
      id: 'mission-auto',
      group: 'missions',
      label: 'mission-auto on|off: hand over each next ready task without asking',
      run: { kind: 'text' as const, keyword: 'mission-auto', make: (value: string) => autoSpec(value), why: (value: string) => (wired === undefined ? why : `type "mission-auto on" or "mission-auto off", not "${value.trim().slice(0, 20)}"`) },
    },
    { id: 'mission-research', group: 'missions', label: 'research the question typed in Missions: screened, then confirm (a billed turn with web access up to the cap)', run: spec(() => local('start the research', () => wired?.research(), { declared: 'spend', levelOnly: true })) },
    { id: 'mission-open', group: 'missions', label: 'open Mission Control', run: { kind: 'view', view: 'missions' } },
  ].map(entry => ({ ...entry, label: mcOf(state) === undefined ? entry.label : entry.label })) as PaletteEntry[]
}
