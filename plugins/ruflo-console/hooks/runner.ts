/**
 * Runs what the person asked for: a palette entry, a claims button, an approval. A change waits for a confirm (y, or
 * `/ruflo yes`) and then runs one fixed argv through the ruflo CLI, after which the disk is re-read to say whether it
 * took; a read runs at once and shows what it printed. Nothing reaches `$` but through the Host.
 */
import type { ActionSpec } from './actions'
import { gateClaudeAsk, levelRefusal, logControl, originOf, type AskOrigin } from './control-policy'
import { rememberKey } from './remember'
import { record } from './data/events'
import { plain } from './data/parse'
import type { Host } from './host'
import { labLines } from './mh-lab'
import { outputLines } from './ops'
import { filterPalette, paletteEntries, textOfQuery, type PaletteEntry } from './palette'
import { CLI_PREFIXES, type Pending, type State } from './state'

export const PENDING_TTL_MS = 30_000

export type RunnerDeps = {
  /** A read of the disk that starts after this call. */
  freshRead: () => Promise<void>
  setView: (view: State['view']) => void
  drill: (agentId: string) => void
  command: (name: 'refresh' | 'help' | 'close') => void
}

export type Runner = {
  /** `origin` is who raised it, captured when it was raised (control-policy.ts): an ask screened first passes the one it captured. */
  ask: (spec: ActionSpec | null, why: string, origin?: AskOrigin) => void
  /** `seen` is the id of the card the person said Yes to: when another card took its place since, nothing runs (ADR-450 T17). */
  confirm: (seen?: number) => Promise<void>
  cancel: () => void
  runEntry: (entry: PaletteEntry, text: string) => void
  /** `exact` (the model path, ADR-450 T13) resolves the id as written and never falls back to fuzzy matching. */
  runById: (id: string, text: string, options?: { exact?: boolean }) => boolean
  /** Resolves when the read started last has finished: `/ruflo run` waits on it to answer with what it printed. */
  settled: () => Promise<void>
  /** Resolves when the last action that brought its own `run` (and is not awaited by `confirm`) has finished: the model tools wait on it, with a limit. */
  finished: () => Promise<void>
}

export function createRunner(state: State, host: Host, deps: RunnerDeps): Runner {
  let pendingSpec: ActionSpec | null = null
  let asks = 0
  let inflight: Promise<void> = Promise.resolve()
  let background: Promise<void> = Promise.resolve()

  const say = (label: string, ok: boolean, detail: string, lines?: string[]) => {
    state.outcome = { label, ok, verified: 'n/a', detail, atMs: Date.now(), ...(lines !== undefined && { lines }) }
    host.invalidate()
  }

  async function execute(spec: ActionSpec): Promise<void> {
    // A harness run reports into the terminal and may take minutes: it does not hold the other buttons.
    if (spec.run !== undefined) {
      const running = spec.run()

      background = running.then(() => undefined, () => undefined)

      // A read that runs its own command (a skills search) is waited on, so `/ruflo run` answers with what it found.
      if (spec.isReadOnly === true) await running

      return
    }

    // The x.ruv.io board keeps its own result panel, so its runs never show in the MetaHarness lab.
    const panel = spec.board === 'xruv' ? state.xruv : state.lab

    state.isActing = true
    if (spec.lab !== undefined) panel.running = { id: spec.lab, label: spec.label, startedAtMs: Date.now() }
    host.invalidate()

    try {
      const result = await host.run(spec.argv ?? [...CLI_PREFIXES[state.options.cli], ...spec.args], spec.timeoutMs ?? 90_000, spec.stdin)
      const answer = /"success"\s*:\s*(true|false)/.exec(result.stdout)?.[1]
      const error = /"error"\s*:\s*"([^"]{0,160})"/.exec(result.stdout)?.[1] ?? /\[ERROR\]\s*(.{0,160})/.exec(result.stdout)?.[1]
      // `mcp exec` wraps a tool's failure as `"isError": true` with its message escaped inside: that is a failure too.
      const ok = result.exitCode === 0 && answer !== 'false' && error === undefined && !/"isError"\s*:\s*true/.test(result.stdout)

      // A lab run's output goes to the lab's result panel, scrolled from its top; the footer keeps the one-line outcome.
      if (spec.lab !== undefined) {
        panel.result = { id: spec.lab, label: spec.label, ok, exitCode: result.exitCode, ...(spec.note !== undefined && { note: spec.note }), lines: spec.read?.(result.stdout, result.stderr, ok) ?? (spec.lines ?? ((out, err) => labLines(spec.lab ?? '', out, err)))(result.stdout, result.stderr), atMs: Date.now() }
        state.select.item = 0
      }
      // Keyed on the exit, not on `ok`: relay text in a read may carry an "error" key of its own.
      if (result.exitCode === 0) spec.onOutput?.(result.stdout)

      if (spec.isReadOnly === true) {
        say(spec.label, ok, ok ? 'the ruflo CLI answered:' : plain(error ?? result.stderr, 160) || `exit ${result.exitCode}`, spec.lab === undefined ? outputLines(result.stdout) : undefined)

        return
      }

      await deps.freshRead()

      const verified = spec.verifyLocal !== undefined
        ? ok && await spec.verifyLocal(host) ? 'yes' : 'no'
        : spec.verify === undefined || state.snapshot === null ? 'n/a' : spec.verify(state.snapshot) ? 'yes' : 'no'

      state.outcome = {
        label: spec.label,
        ok: ok && verified !== 'no',
        verified,
        detail: ok ? `${spec.argv === undefined ? 'ruflo' : 'the command'} answered ok; expected ${spec.expect}` : plain(error ?? result.stderr, 160) || `exit ${result.exitCode}`,
        atMs: Date.now(),
      }
    } catch (error) {
      const why = plain(error instanceof Error ? error.message : String(error), 160) || 'refused'

      if (spec.lab !== undefined) panel.result = { id: spec.lab, label: spec.label, ok: false, exitCode: null, ...(spec.note !== undefined && { note: spec.note }), lines: [why], atMs: Date.now() }
      say(spec.label, false, why)
    } finally {
      state.isActing = false
      panel.running = null
      host.invalidate()
    }
  }

  function ask(spec: ActionSpec | null, why: string, origin: AskOrigin = originOf(state)): void {
    state.palette.isOpen = false
    // Where this came from: the page puts the confirm and the answer right after that element. A headless run has no press, so it falls back to the top.
    state.origin = state.lastPressed
    state.lastPressed = null

    const byClaude = origin.by === 'claude'

    // Claude never replaces or clears an action waiting for the person (ADR-450 T17): the card they are reading stays the one their Yes runs.
    // A screened ask of Claude's can land at any moment after its tool call returned, so this holds here and not only in the model tools.
    if (byClaude && state.pending !== null) {
      logControl(state, 'ask', `not asked: ${spec?.label ?? 'nothing'}`, 'denied', `"${state.pending.label}" was waiting for the person`)
      say(spec?.label ?? 'nothing to do', false, `not asked: "${plain(state.pending.label, 60)}" is waiting for your answer`)

      return
    }

    if (spec === null) {
      pendingSpec = null
      state.pending = null
      say('nothing to do', false, why)

      return
    }

    // An entry that declares a class is read-only for the person (their click is the consent) but not for Claude: a network read, a palette
    // wrapper that starts a turn or writes the mission ledger. Claude's call of it goes through the gate below like any other (ADR-444 levels).
    const isGated = byClaude && spec.declared !== undefined

    if (spec.isReadOnly === true && !isGated) {
      inflight = execute(spec)

      return
    }

    // An entry that only fills a field, or raises its own ask (screened first, then gated when it lands): Claude's level is checked, nothing more.
    if (isGated && spec.levelOnly === true) {
      const refused = levelRefusal(state, spec, origin.level)

      if (refused !== null) {
        logControl(state, 'ask', spec.label, 'denied', refused)
        say(spec.label, false, refused)

        return
      }

      inflight = execute(spec)

      return
    }

    // A kind of action the person said never to ask about again runs now, its label saying so. That answer is the person's: an action
    // Claude asked for (ADR-444) still goes through the pending path, where the control level and the confirm mode decide.
    const kind = rememberKey(spec)

    if (kind !== null && state.allowed.has(kind) && !byClaude) {
      inflight = execute({ ...spec, label: `${spec.label} (remembered: not asked)` })

      return
    }

    asks += 1

    const pending: Pending = { id: asks, view: state.view, ...(kind !== null && { rememberKey: kind }), ...(spec.scope !== undefined && { scope: spec.scope }), label: spec.label, args: spec.args, expect: spec.expect, askedAtMs: Date.now(), source: byClaude ? 'claude' : 'you', ...(spec.shows !== undefined && { shows: spec.shows }), ...(spec.note !== undefined && { note: spec.note }), ...(spec.declared !== undefined && { declared: spec.declared }) }

    // Claude's ask that lands after its tool call returned (it was screened first): no call is left to settle it, so the same gate runs here.
    // It always waits for the person, even in auto: nobody is there to report what an unattended run did.
    if (byClaude && !state.control.viaModel) {
      // Stop pressed meanwhile refuses before the gate, so a refused ask is not counted against the budget.
      const gate = state.control.paused ? null : gateClaudeAsk(state, pending, origin.level)

      if (gate === null || gate.verdict === 'level' || gate.verdict === 'budget') {
        const why = gate === null ? 'the person took control back' : gate.verdict === 'level' ? `a ${gate.kind} action needs more than "${gate.level}"` : `the session budget for ${gate.kind} actions is used up`

        logControl(state, 'ask', spec.label, 'denied', why)
        say(spec.label, false, `Claude's ask was not queued: ${why}`)

        return
      }

      if (gate.kind !== 'read') pending.kind = gate.kind
      logControl(state, 'ask', spec.label, 'waiting', 'screened first; waits for the person')
    }

    pendingSpec = spec
    state.pending = pending
    host.invalidate()
  }

  async function confirm(seen?: number): Promise<void> {
    // The Yes answers the card the person read. If another card took its place before the key landed, the new one stays to be read.
    if (seen !== undefined && state.pending !== null && state.pending.id !== seen) {
      say(state.pending.label, false, 'the card changed before your Yes: read it, then answer again')

      return
    }

    const spec = pendingSpec
    const isFresh = state.pending !== null && Date.now() - state.pending.askedAtMs < PENDING_TTL_MS

    const waitedMs = state.pending === null ? 0 : Date.now() - state.pending.askedAtMs

    pendingSpec = null
    state.pending = null

    if (spec === null || !isFresh || state.isActing) {
      if (spec !== null && !isFresh) {
        say(spec.label, false, 'the confirm came more than 30 s after the ask; ask again')
        // `say` is one slot that the next action overwrites; the event stays in the feed (ADR-448 §3.2).
        record(state.events, [{ atMs: Date.now(), kind: 'tools', text: `confirm for "${plain(spec.label, 60)}" came ${Math.round(waitedMs / 1000)}s after the ask and was not run (${PENDING_TTL_MS / 1000}s window)` }])
      }

      host.invalidate()

      return
    }

    await execute(spec)
  }

  function cancel(): void {
    pendingSpec = null
    state.pending = null
    host.invalidate()
  }

  function runEntry(entry: PaletteEntry, text: string): void {
    state.palette.isOpen = false

    switch (entry.run.kind) {
      case 'spec':
        ask(entry.run.spec, entry.run.why)
        break
      case 'text':
        ask(entry.run.make(text), entry.run.why?.(text) ?? `type "${entry.run.keyword} <text>"; text may not start with -`)
        break
      case 'view':
        deps.setView(entry.run.view)
        break
      case 'drill':
        deps.drill(entry.run.agentId)
        break
      case 'command':
        deps.command(entry.run.name)
        break
    }

    host.invalidate()
  }

  /** A palette entry by its id (`/ruflo run <id> [text]`, an approval's button): false when there is none now. */
  function runById(id: string, text: string, options: { exact?: boolean } = {}): boolean {
    const entries = paletteEntries(state, Date.now())
    const entry = entries.find(candidate => candidate.id === id) ?? (text === '' || options.exact === true ? undefined : filterPalette(entries, `${id} ${text}`, 'all')[0])

    if (entry === undefined) return false

    runEntry(entry, entry.run.kind === 'text' ? textOfQuery(`${id} ${text}`, entry.run.keyword) : text)

    return true
  }

  return { ask, confirm, cancel, runEntry, runById, settled: () => inflight, finished: () => background }
}
