/**
 * The management views: the agent timeline, the approvals queue and the event stream. Each acts through the palette's
 * entries (by id), so a button here runs exactly what the palette or `/ruflo run <id>` would.
 */
import type { RenderElement } from 'claude-code'

import { approvalsOf } from '../data/alerts'
import { isoOf } from '../data/bounds'
import { EVENT_KINDS } from '../data/events'
import type { Lane } from '../gfx/maps'
import { sparkline } from '../memory-lines'
import { idOf, eventsShown, kindCounts, PAGE, perMinute, RANGES, watchOf } from '../watch'
import { lanesOf } from './frames'
import { ago, button, clip, col, picture, row, rule, text, THEME, type Ctx } from './common'

const chip = (ctx: Ctx, key: string, label: string, isOn: boolean, onPress: () => void): RenderElement =>
  ctx.kit.Button({ key, label: ` ${isOn ? '●' : '○'} ${label} `, plain: true, ...(isOn && { variant: 'primary' as const }), onPress })

/** Busy time as a share of the time this lane was observed in the window, and its tool calls. */
export function statsOf(lane: Lane, fromMs: number, nowMs: number): { observedMs: number; busyMs: number; calls: number } {
  const spans = lane.spans.filter(span => span.toMs > fromMs)
  const first = spans.length === 0 ? nowMs : Math.max(fromMs, Math.min(...spans.map(span => span.fromMs)))

  return { observedMs: Math.max(0, nowMs - first), busyMs: spans.filter(span => span.busy).reduce((sum, span) => sum + Math.max(0, span.toMs - Math.max(span.fromMs, fromMs)), 0), calls: lane.ticks.filter(at => at >= fromMs).length }
}

export function timelineView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const watch = watchOf(state)
  const agents = state.snapshot?.agents.length ?? 0
  const lanes = lanesOf(state, nowMs)
  const rows: RenderElement[] = [rule(ctx, 'Timeline', `last ${RANGES.find(range => range.ms === watch.rangeMs)?.label ?? '15 min'} · observed since the console loaded`)]

  rows.push(row(ctx, [text(ctx, ' look back '), ...RANGES.map(range => chip(ctx, `tl-range-${range.ms / 60_000}`, range.label, watch.rangeMs === range.ms, () => ctx.act.watch.range(range.ms)))], 'tl-ranges'))
  rows.push(picture(ctx, 'gantt', agents === 0 && state.toolsByAgent.size === 0 ? 'no agents and no tool calls seen yet' : `${agents} agents`))
  rows.push(text(ctx, '█ busy · ▁ idle (ruflo agent status, as each read saw it) · ▮ a tool call Claude Code made (main session and subagents)', { dimColor: true }))
  rows.push(text(ctx, "ruflo agents' own tool calls are not visible to Claude Code: their rows show status only", { dimColor: true }))

  if (lanes.length > 0) {
    rows.push(rule(ctx, 'Who was busy', 'a share of the time each lane was observed in this window'))

    for (const [i, lane] of lanes.slice(0, 12).entries()) {
      const stats = statsOf(lane, nowMs - watch.rangeMs, nowMs)
      const share = stats.observedMs === 0 ? null : Math.round((stats.busyMs / stats.observedMs) * 100)

      rows.push(
        row(
          ctx,
          [
            ctx.kit.Text({ bold: true, color: THEME.head, children: ` ${clip(lane.label, 20).padEnd(20)}` }),
            ctx.kit.Text({ color: share === null ? THEME.info : share >= 60 ? THEME.ok : share >= 20 ? THEME.warn : THEME.info, children: ` ${share === null ? 'no status seen' : `busy ${share}%`}${stats.observedMs > 0 ? ` of ${Math.max(1, Math.round(stats.observedMs / 60_000))} min` : ''}` }),
            ctx.kit.Text({ dimColor: true, children: ` · ${stats.calls} tool call${stats.calls === 1 ? '' : 's'} ` }),
            ctx.kit.Button({ key: `tl-ask-${i}`, label: ' ✦ ask Claude ', plain: true, dimColor: true, onPress: () => ctx.act.watch.ask(`In my ruflo swarm, the agent "${lane.label}" was busy ${share ?? 'n/a'}% of ${Math.round(stats.observedMs / 60_000)} minutes with ${stats.calls} tool calls. Is that healthy, and what should I look at?`) }),
          ],
          `tl-lane-${i}`,
        ),
      )
    }
  }

  return col(ctx, rows, 'timeline')
}

export function approvalsView(ctx: Ctx): RenderElement {
  const items = approvalsOf(ctx.state)
  const picked = items.length === 0 ? -1 : ((ctx.state.select.item % items.length) + items.length) % items.length
  const rows: RenderElement[] = [rule(ctx, 'Approvals', items.length === 0 ? 'nothing waiting' : `${items.length} waiting · j/k pick`)]

  if (items.length === 0) {
    rows.push(text(ctx, 'No hive-mind proposals, stealable claims, refused mods, permission denies or budget alerts waiting.', { dimColor: true }))
  }

  items.slice(0, 12).forEach((item, i) => {
    const isPicked = i === picked

    rows.push(text(ctx, `${isPicked ? '▸' : ' '} [${item.kind}] ${item.text}`, isPicked ? { bold: true, color: THEME.head } : { color: item.kind === 'policy-deny' || item.kind === 'mod-trust' ? THEME.bad : THEME.warn }))
    rows.push(text(ctx, `    ${item.detail}`, { dimColor: true }))

    if (isPicked && item.actions.length > 0 && ctx.columns >= 44) {
      rows.push(row(ctx, item.actions.map((action, a) => button(ctx, `approve-${a}`, action.label, () => void ctx.act.run(action.paletteId), a < 2 ? { hotkey: a === 0 ? 'v' : 'w' } : {}))))
    }
  })

  if (ctx.columns >= 44 && items.length > 1) rows.push(row(ctx, [button(ctx, 'item-prev', 'prev', () => ctx.act.select(-1), { hotkey: 'k' }), button(ctx, 'item-next', 'next', () => ctx.act.select(1), { hotkey: 'j' })]))

  rows.push(text(ctx, 'each action asks y/n before it runs; a permission deny is shown, never loosened from here', { dimColor: true }))

  return col(ctx, rows, 'approvals')
}

const KIND_COLOR: Record<string, string> = { swarm: THEME.info, claims: THEME.warn, federation: THEME.ok, learning: THEME.head, tools: THEME.info, mods: THEME.bad, missions: THEME.head }

export function eventsView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const watch = watchOf(state)
  const filter = state.eventFilter
  const shown = eventsShown(state)
  const counts = kindCounts(state)
  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const page = Math.min(watch.page, pages - 1)
  const newest = shown.slice().reverse()
  const visible = newest.slice(page * PAGE, page * PAGE + PAGE)
  const fresh = watch.pausedAt === null ? 0 : state.events.length - watch.pausedAt
  const rows: RenderElement[] = [rule(ctx, 'Events', `${shown.length} shown · ${filter === 'all' ? 'every kind' : filter}${watch.query === '' ? '' : ` · "${watch.query}"`}${watch.pausedAt === null ? ' · live' : ` · paused (${fresh} new)`}`)]

  rows.push(
    row(ctx, [text(ctx, ' kind '), chip(ctx, 'ev-kind-all', `all ${state.events.length}`, filter === 'all', () => ctx.act.watch.kind('all')), ...EVENT_KINDS.filter(kind => (counts.get(kind) ?? 0) > 0 || filter === kind).map(kind => chip(ctx, `ev-kind-${kind}`, `${kind} ${counts.get(kind) ?? 0}`, filter === kind, () => ctx.act.watch.kind(kind)))], 'ev-kinds'),
  )

  const Input = ctx.kit.Input

  rows.push(
    row(
      ctx,
      [
        ...(Input === undefined ? [] : [ctx.kit.Box({ key: 'ev-query-box', borderStyle: 'round', borderColor: THEME.info, paddingX: 1, children: [Input({ key: 'ev-query', label: '🔎 find', placeholder: 'words in an event, or a kind (Enter)', submitLabel: 'find', onSubmit: (value: string) => ctx.act.watch.query(value) })] })]),
        ctx.kit.Button({ key: 'ev-pause', label: watch.pausedAt === null ? ' ⏸ pause ' : ' ▶ resume ', ...(watch.pausedAt === null ? { plain: true as const } : { variant: 'primary' as const }), onPress: () => ctx.act.watch.pause() }),
        ...(watch.query === '' ? [] : [ctx.kit.Button({ key: 'ev-clear', label: ' ✕ clear find ', plain: true, dimColor: true, onPress: () => ctx.act.watch.query('') })]),
      ],
      'ev-tools',
    ),
  )
  rows.push(text(ctx, ` last 15 min, per minute  ${sparkline(perMinute(shown, nowMs))}  now`, { color: THEME.info }))

  if (shown.length === 0) rows.push(text(ctx, state.events.length === 0 ? 'Nothing has changed since the console loaded. Events are what changed between reads, and what this session did.' : 'no event matches this filter and search', { dimColor: true }))

  for (const event of visible) {
    const id = idOf(event)
    const isOpen = watch.open === id

    rows.push(
      row(
        ctx,
        [
          ctx.kit.Text({ dimColor: true, children: `${ago(event.atMs, nowMs).padStart(8)} ` }),
          ctx.kit.Text({ color: KIND_COLOR[event.kind] ?? THEME.info, children: `${event.kind.padEnd(10)} ` }),
          ctx.kit.Button({ key: `ev-open-${id}`, label: `${isOpen ? '▾' : '▸'} ${clip(event.text, Math.max(16, ctx.columns - 26))}`, plain: true, onPress: () => ctx.act.watch.open(id) }),
        ],
        `ev-${id}`,
      ),
    )

    if (isOpen) {
      rows.push(text(ctx, `     ${event.text}`, { bold: true }))
      rows.push(text(ctx, `     ${event.kind} · ${isoOf(event.atMs) ?? 'n/a'}${event.agentId === undefined ? '' : ` · agent ${event.agentId}`}`, { dimColor: true }))
      rows.push(row(ctx, [ctx.kit.Button({ key: 'ev-ask', label: ' ✦ ask Claude about this event ', plain: true, onPress: () => ctx.act.watch.ask(`This event appeared in my ruflo console: "${event.text}" (kind ${event.kind}). What does it mean, and should I do anything?`) })], 'ev-detail'))
    }
  }

  if (pages > 1) {
    rows.push(row(ctx, [text(ctx, ` page ${page + 1}/${pages} `, { dimColor: true }), ...(page < pages - 1 ? [button(ctx, 'ev-older', 'older ▸', () => ctx.act.watch.page(1))] : []), ...(page > 0 ? [button(ctx, 'ev-newer', '◂ newer', () => ctx.act.watch.page(-1))] : [])], 'ev-pages'))
  }

  if (ctx.columns >= 44) rows.push(row(ctx, [button(ctx, 'filter', `Filter: ${filter} (cycle)`, ctx.act.filter, { hotkey: 'f' })]))

  return col(ctx, rows, 'events')
}
