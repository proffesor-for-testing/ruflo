/**
 * What Claude may do through the console (ADR-444, ADR-450): the control levels, the class of an action and the level it needs, the
 * classes that always wait for the person, the per-session budgets, and the gate an ask Claude raised goes through. It is its own module
 * so the runner can hold an ask that lands after Claude's tool call has returned (a screened ask, ADR-450 T14/T17) to the same rules as
 * `settlePending` in model-tools.ts, without importing the model tools themselves.
 */
import { plain } from './data/parse'
import { settingsOf } from './settings'
import type { ControlEntry, Pending, State } from './state'

export const LEVELS = ['off', 'read', 'write', 'manage', 'full'] as const
export type ControlLevel = (typeof LEVELS)[number]
export type ControlConfirm = 'ask' | 'auto'
/** What an action does, read from its spec; the level it needs follows. */
export type ActionClass = 'read' | 'write' | 'network' | 'install' | 'spend' | 'delete'

const LOG_MAX = 40

export const NEEDS: Record<ActionClass, ControlLevel> = { read: 'read', write: 'write', network: 'manage', install: 'full', spend: 'full', delete: 'full' }
export const rank = (level: ControlLevel): number => LEVELS.indexOf(level)

/**
 * The words that put an action in a class (ADR-450). They are read from the console's own label, command and notes. Only the console's own
 * prose (`note`, `shows`) is cleaned of what an action does NOT do; the label and the command (which carry typed text) are read as they are,
 * so typed text can only add words, never cancel one. Matching is by stem, so "deleting", "removal" and "deletes" count. Anything it does not
 * name stays 'write': the list is a floor, not a proof.
 */
const DELETE = /\b(delet|remov|kill|terminat|destr[ou]y|shut ?down|stop|reset|rollback|cancel|wip(e|ing)|purg|prun|uninstall|force|clean ?up|migrat|drop|eras|unlink|truncat|revok|discard|flush|evict|unregister|nuke|abort|shell command|runs a shell|runs your (test|code)|terminal_execute|rm -)/
const SPEND = /\$\$|billed|costs? money|may cost|model turn|starts a (claude|codex)|spends (money|tokens|credits)|\bpaid\b|may call models|calls the anthropic api|with your (anthropic |api )?key|api key|openrouter|real (model|judge)/
/** Code that runs with Claude Code's own access, or settings and hooks that change how it behaves: plugin and marketplace changes (ADR-450 T8). */
const INSTALL = /\b(install\w*|marketplace|claude plugin|plugin (enable|disable|update)|enabledplugins|settings(\.local)?\.json|hooks\.json)/
const NETWORK = /\b(network|publish|deploy|push|install|download|fetch|registry|github|npm|gcloud|upload|update|clone|join|federat|reaches|curl|https?:|ssh|webhook|slack|ipfs|pi\.ruv\.io|x\.ruv\.io|relay|peer|broadcast|sends?|sync)/

/** Which class an action is, from its label, command and notes; anything unclear counts as the most dangerous class. */
/** From least to most dangerous: the stricter of the class read from the words and the class the entry declares wins. */
const SEVERITY: readonly ActionClass[] = ['read', 'write', 'network', 'install', 'spend', 'delete']
const stricter = (a: ActionClass, b: ActionClass | undefined): ActionClass => (b !== undefined && SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a)

export function classOf(pending: Pick<Pending, 'label' | 'args' | 'note' | 'shows' | 'expect' | 'declared'>): ActionClass {
  return stricter(classFromWords(pending), pending.declared)
}

function classFromWords(pending: Pick<Pending, 'label' | 'args' | 'note' | 'shows' | 'expect'>): ActionClass {
  // The console's own notes say what an action does NOT do too ("spends nothing", "not a charge", "runs no agent"): those must not count.
  const prose = `${pending.note ?? ''} ${pending.shows ?? ''}`
    .toLowerCase()
    .replace(/\b(spends|costs|charges|bills|runs|starts|takes)\s+(nothing|no\b[^.;,]{0,30})/g, ' ')
    .replace(/\b(no|not|never|without)\s+(a\s+|an\s+)?(spend\w*|billed|charge\w*|cost\w*|model turn|ai turn|agent|credits?)\b/g, ' ')
  const text = `${pending.label} ${pending.args.join(' ')}`.toLowerCase() + ' \u00a6 ' + prose

  if (DELETE.test(text)) return 'delete'
  if (SPEND.test(text)) return 'spend'
  if (INSTALL.test(text)) return 'install'
  if (NETWORK.test(text)) return 'network'

  return 'write'
}

/** True when `level` lets Claude run an action of class `kind`. */
export const allows = (level: ControlLevel, kind: ActionClass): boolean => rank(level) >= rank(NEEDS[kind])

export const levelOf = (value: unknown): ControlLevel => LEVELS.find(level => level === value) ?? 'off'
export const confirmOf = (value: unknown): ControlConfirm => (value === 'ask' ? 'ask' : 'auto')

/** `RUFLO_CONSOLE_CONTROL=write:auto` (level, then ask|auto): one session's setting, for a recording or a test; null when not a valid pair. */
export function parseControlEnv(value: unknown): { level: ControlLevel; confirm: ControlConfirm } | null {
  const [level, confirm = 'auto'] = typeof value === 'string' ? value.trim().toLowerCase().split(':') : []
  const found = LEVELS.find(candidate => candidate === level)

  return found === undefined || (confirm !== 'ask' && confirm !== 'auto') ? null : { level: found, confirm }
}

/**
 * The session override can only LOWER what the person saved, never raise it (ADR-450 T12): a project's settings `env` must not be able to hand
 * Claude `full:auto`. The level is the lower of the two; the confirm is `ask` if either says ask.
 */
export function lowerOnly(saved: { level: ControlLevel; confirm: ControlConfirm }, forced: { level: ControlLevel; confirm: ControlConfirm } | null): { level: ControlLevel; confirm: ControlConfirm } {
  if (forced === null) return saved

  return { level: rank(forced.level) < rank(saved.level) ? forced.level : saved.level, confirm: forced.confirm === 'ask' || saved.confirm === 'ask' ? 'ask' : 'auto' }
}

/** Classes whose effect leaves the machine, costs money or cannot be undone: they always wait for the person, whatever `modelConfirm` says (ADR-450 T8). */
export const ALWAYS_ASK: readonly ActionClass[] = ['network', 'install', 'spend', 'delete']

/**
 * How many actions of each class Claude may put through the console in one session (ADR-450 T8). The per-turn cap bounds one turn; a /loop gets
 * a fresh turn each time, so this one spans the session. Past it, a write action waits for the person's Yes even in auto, and an action of a
 * class that always asks is refused, so the person is not asked again and again for the same kind of thing.
 */
export const SESSION_BUDGET: Record<Exclude<ActionClass, 'read'>, number> = { write: 20, network: 5, install: 2, spend: 3, delete: 3 }

/** One line in the control log (the dashboard's audit trail, views/control.ts). */
export const logControl = (state: State, tool: string, summary: string, outcome: ControlEntry['outcome'], detail = ''): void => {
  state.control.log.push({ atMs: Date.now(), tool, summary: plain(summary, 80), outcome, detail: plain(detail, 160) })
  if (state.control.log.length > LOG_MAX) state.control.log.splice(0, state.control.log.length - LOG_MAX)
}

/**
 * Who raised an ask, captured at the moment it was raised. An ask that is screened by AIDefence first (ask, mission-guide, research) lands
 * after Claude's tool call has returned and `viaModel` is false again: without this it would be attributed to the person and skip the
 * level, the budget and the class shown on the card (ADR-450 T8, T14). The level is the one Claude had when it asked; `call` is the tool call
 * that raised it (`state.control.calls` counts every call), so an ask that lands during a LATER call of Claude's is still known to be late.
 */
export type AskOrigin = { by: 'you' } | { by: 'claude'; level: ControlLevel; call: number }

export const originOf = (state: State): AskOrigin => (state.control.viaModel ? { by: 'claude', level: levelOf(settingsOf(state).ai.modelControl), call: state.control.calls } : { by: 'you' })

/** What the gate decided for an ask of Claude's: refused for its level or an always-ask budget, else it waits for the person or may confirm itself. */
export type Gate =
  | { verdict: 'level'; kind: ActionClass; level: ControlLevel }
  | { verdict: 'budget'; kind: ActionClass; level: ControlLevel; budget: number }
  | { verdict: 'wait' | 'auto'; kind: ActionClass; level: ControlLevel; budget: number; over: boolean }

type Classed = Pick<Pending, 'label' | 'args' | 'note' | 'shows' | 'expect' | 'declared'>

/** The level Claude acts at: the lower of the one it had when it asked and the one saved now (the person may have lowered it since). */
function levelFor(state: State, asked: ControlLevel | undefined): ControlLevel {
  const now = levelOf(settingsOf(state).ai.modelControl)

  return asked !== undefined && rank(asked) < rank(now) ? asked : now
}

/**
 * The one gate every ask of Claude's goes through, whether `settlePending` meets it during the tool call or the runner meets it when a
 * screened ask lands later (ADR-450 T8): the class (the stricter of its words and what the entry declares), the level it needs, the
 * session budget per class, and whether it may confirm itself. A pass is counted against the budget.
 */
export function gateClaudeAsk(state: State, pending: Classed, asked?: ControlLevel): Gate {
  const ai = settingsOf(state).ai
  const level = levelFor(state, asked)
  const kind = classOf(pending)

  if (!allows(level, kind)) return { verdict: 'level', kind, level }

  const budget = kind === 'read' ? Infinity : SESSION_BUDGET[kind]
  const used = state.control.used[kind] ?? 0
  const over = used >= budget

  if (over && ALWAYS_ASK.includes(kind)) return { verdict: 'budget', kind, level, budget }

  state.control.used[kind] = used + 1

  return { verdict: confirmOf(ai.modelConfirm) === 'ask' || ALWAYS_ASK.includes(kind) || over ? 'wait' : 'auto', kind, level, budget, over }
}

/** Why Claude may not even start an entry that only fills a field or raises its own (gated) ask: null when its level allows the class. */
export function levelRefusal(state: State, spec: Classed, asked?: ControlLevel): string | null {
  const level = levelFor(state, asked)
  const kind = classOf(spec)

  return allows(level, kind) ? null : `Refused: "${plain(spec.label, 80)}" is a ${kind} action and control is set to "${level}" (it needs "${NEEDS[kind]}"). The person can raise it in Settings → Claude control. Nothing ran.`
}
