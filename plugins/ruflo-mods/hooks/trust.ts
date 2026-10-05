import type { On } from 'claude-code'

/**
 * The mod trust gate (ADR-404). Claude Code can now write, install and
 * hot-reload a mod mid-session, and a mod runs with Claude Code's own access.
 * A user-tier hook on `plugin.register` judges every hooks module admitted
 * after it (and every reload), reading what the host scanned the module to
 * use; it may answer `{ refuse }`. This gate names what a module could do and,
 * only when the person opts in, refuses user-tier modules that can do the
 * risky things below. It reads the scan, never the module's own claims.
 *
 * What it cannot do: judge modules admitted before it (the host orders
 * admission), or any prepend/append/builtin module (the organization's and
 * Claude Code's own, out of a person's reach by design).
 */

export type TrustPolicy = 'observe' | 'refuse-risky' | 'off'

export type ModuleScan = {
  readonly name: string
  readonly tier: string
  readonly provenance: string
  readonly uses: { readonly events?: readonly string[]; readonly calls?: readonly string[]; readonly env?: unknown }
}

/** Calls that reach outside the session: commands, network, the environment. */
const RISKY_CALLS: Record<string, string> = {
  'process.run': 'runs host commands',
  'process.spawn': 'runs host commands',
  'http.fetch': 'makes network requests',
  'mcp.call': 'calls MCP tools (any connected server)',
  'mcp.connect': 'connects MCP servers',
  'session.send': 'sends messages to other agents',
  'config.set': 'changes Claude Code settings',
  'env.set': 'changes the environment of later hooks and tools',
  'fs.write': 'writes files (settings, hooks, helpers included)',
}

/** Hooks that decide for, or over, everything else. */
const RISKY_EVENTS: Record<string, string> = {
  'tool.check': 'can answer tool permission verdicts',
  'tool.call': 'can rewrite or answer tool calls',
  '*': 'sees every event',
  'classic.*': 'can answer every settings hook',
  'plugin.register': 'can refuse other mods',
  'prompt.compose': 'can rewrite the system prompt',
  'prompt.submit': 'can rewrite or add context to every prompt',
  'agent.spawn': 'can rewrite or answer subagent spawns',
}

const isStrings = (v: unknown): v is readonly string[] => Array.isArray(v) && v.every(s => typeof s === 'string')

/** What a module's scan says it could do that matters, as readable reasons. */
export function riskOf(scan: ModuleScan): string[] {
  const calls = isStrings(scan.uses?.calls) ? scan.uses.calls : []
  const events = isStrings(scan.uses?.events) ? scan.uses.events : []
  return [
    ...calls.filter(c => c in RISKY_CALLS).map(c => `${c} (${RISKY_CALLS[c]})`),
    ...events.filter(ev => ev in RISKY_EVENTS).map(ev => `on ${ev} (${RISKY_EVENTS[ev]})`),
  ]
}

export type TrustDecision = { readonly judged: boolean; readonly risk: readonly string[]; readonly refuse?: string }

/**
 * Judges one registering module: user-tier modules not on the allow-list;
 * refusal only under `refuse-risky`. The allow-list matches the loader's
 * `provenance` (`name@marketplace`, `name@inline`), never the module's own
 * `name`, which is its manifest's word and a rename walks past. There is no
 * self-exemption: a module only judges those admitted after it, so ruflo-mods
 * never meets its own registration, and a mod calling itself "ruflo-mods" is
 * judged like any other.
 */
export function judge(scan: ModuleScan, policy: TrustPolicy, allow: ReadonlySet<string>): TrustDecision {
  if (policy === 'off' || scan.tier !== 'user' || allow.has(scan.provenance)) {
    return { judged: false, risk: [] }
  }
  const risk = riskOf(scan)
  return policy === 'refuse-risky' && risk.length > 0
    ? {
        judged: true,
        risk,
        refuse: `ruflo mod trust (modTrust=refuse-risky): ${scan.name} ${risk.join('; ')}; allow it by provenance (${scan.provenance}) in modTrustAllow`,
      }
    : { judged: true, risk }
}

/** The one line a person reads about a judged module. */
export const trustLine = (scan: ModuleScan, d: TrustDecision) =>
  `ruflo mod trust: ${scan.name} (${scan.provenance}) ${d.refuse ? 'REFUSED' : 'loaded'}${d.risk.length ? `; ${d.risk.join('; ')}` : '; no risky calls or hooks'}`

export function registerTrust(on: On, policy: TrustPolicy, allow: ReadonlySet<string>) {
  if (policy === 'off') return
  const told = new Set<string>()

  on('plugin.register', async ($, e, next) => {
    const decision = judge(e, policy, allow)
    if (!decision.judged) return next(e)
    // Keyed on what the module can do: a reload that gains a risky call or hook is named again.
    const key = `${e.provenance}:${decision.refuse ? 'refused' : 'loaded'}:${[...decision.risk].sort().join('|')}`
    if (!told.has(key)) {
      told.add(key)
      try {
        $.ui.log(trustLine(e, decision), decision.risk.length ? undefined : { to: 'debug' })
      } catch {
        // a withheld ui.log never decides admission
      }
    }
    return decision.refuse ? { refuse: decision.refuse } : next(e)
  }).catch(($, e, next) =>
    // Observing, a failure admits as Claude Code would without ruflo; set to
    // refuse, the gate guards something, so a module it could not judge stays out.
    policy === 'refuse-risky' && e.tier === 'user' && !allow.has(e.provenance)
      ? { refuse: `ruflo mod trust could not judge ${e.name} (${next.error.message ?? next.error.kind}); refused (modTrust=refuse-risky)` }
      : next(e),
  )
}
