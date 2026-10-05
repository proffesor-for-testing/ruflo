/**
 * Performance: the `ruflo performance` verbs and the MCP performance tools, as fixed argv checked against
 * commands/performance.ts and mcp-tools/performance-tools.ts. The CLI's `metrics`, `profile` and the wasm benchmark
 * measure in-process and write nothing, so they run at once; `performance_report`, `_bottleneck` and `_optimize` write
 * (metrics.json, a probe file), and the full benchmark stores memory entries and loads the embedding model, so those ask.
 * The CLI's own `bottleneck` and `optimize` print a fixed table, not a measurement, so the console asks the MCP tools.
 * The latency samples each run reports are kept per State here for the view's sparklines. Pure: no `$`.
 */
import { exec } from './actions'
import { finiteIn, shownOf } from './data/bounds'
import { jsonAfter } from './data/cli'
import { plain, recordOf } from './data/parse'
import { labLines } from './mh-lab'
import { mcpReader, textLines, type Reader, type SecCost } from './secure'
import type { State } from './state'

export type PerfEntry = { id: string; name: string; about: string; label: string; cost: SecCost; args: readonly string[]; read: Reader; note?: string; timeoutMs?: number }

/** Event-loop latency per `metrics` run (ms), and the report's stored history of self-probe latency (ms), oldest first. */
export type PerfMemo = { loop: number[]; report: number[]; heapMb: number | null; atMs: number }

const memos = new WeakMap<State, PerfMemo>()
const KEEP = 40

export function perfMemo(state: State): PerfMemo {
  const held = memos.get(state)

  if (held !== undefined) return held

  const fresh: PerfMemo = { loop: [], report: [], heapMb: null, atMs: 0 }

  memos.set(state, fresh)

  return fresh
}

const BARS = '▁▂▃▄▅▆▇█'

/** A series as one row of block characters, scaled from its own minimum to its maximum; `width` newest samples. */
export function sparkline(values: readonly number[], width = 32): string {
  const shown = values.filter(value => Number.isFinite(value)).slice(-width)

  if (shown.length === 0) return ''

  const lo = Math.min(...shown)
  const span = Math.max(...shown) - lo

  return shown.map(value => BARS[span === 0 ? 3 : Math.round(((value - lo) / span) * (BARS.length - 1))] ?? '▁').join('')
}

/** A latency the CLI measured: 0 to a day in ms; anything else is not a sample. */
const msIn = (value: unknown): number | undefined => finiteIn(value, 0, 86_400_000)
/** A byte count the CLI measured: 0 to a petabyte. */
const bytesIn = (value: unknown): number | undefined => finiteIn(value, 0, 1e15)
const ms = (value: unknown, digits = 3): string => (msIn(value) === undefined ? 'n/a' : `${(value as number).toFixed(digits)}ms`)
const mb = (bytes: unknown): string => (bytesIn(bytes) === undefined ? 'n/a' : `${((bytes as number) / 1024 / 1024).toFixed(1)} MB`)
const share = (value: unknown, max: number, digits: number): string => (finiteIn(value, 0, max) === undefined ? 'n/a' : `${(value as number).toFixed(digits)}%`)

/** `performance metrics --format json`: memory, CPU, load and the event-loop latency, which feeds the sparkline. */
export const metricsReader: Reader = (stdout, stderr, state) => {
  const record = recordOf(jsonAfter(stdout))

  if (record === null) return textLines(stdout, stderr)

  const memory = recordOf(record.memory) ?? {}
  const cpu = recordOf(record.cpu) ?? {}
  const latency = recordOf(record.latency) ?? {}
  const cache = recordOf(record.cache) ?? {}
  const avg = msIn(latency.avgMs) ?? null
  const memo = perfMemo(state)

  if (avg !== null) memo.loop = [...memo.loop, avg].slice(-KEEP)
  memo.heapMb = bytesIn(memory.heapUsed) === undefined ? null : (memory.heapUsed as number) / 1024 / 1024
  memo.atMs = Date.now()

  const load = Array.isArray(cpu.loadAverage) ? cpu.loadAverage.flatMap(value => (finiteIn(value, 0, 1e6) === undefined ? [] : [(value as number).toFixed(2)])).join(' ') : 'n/a'

  return [
    `event-loop latency ${ms(avg)} · heap ${mb(memory.heapUsed)} of ${mb(memory.heapTotal)} · rss ${mb(memory.rss)}`,
    `system memory ${share(memory.systemPercent, 100, 0)} · load ${load}`,
    `embedding cache ~${shownOf(cache.entries)} entries · HNSW ${shownOf(cache.hnswEntries)} entries`,
    'measured in the CLI process at the moment it ran: one sample per run',
  ]
}

/** `performance benchmark --output json`: each operation's mean, p95 and p99. */
export const benchReader: Reader = (stdout, stderr) => {
  const record = recordOf(jsonAfter(stdout))
  const results = (Array.isArray(record?.results) ? record.results : null)?.map(recordOf).filter(row => row !== null)

  if (record === null || results === undefined) return textLines(stdout, stderr)

  return [
    `suite ${plain(String(record.suite ?? 'n/a'), 12)} · ${shownOf(record.iterations)} iterations · ${plain(shownOf(record.totalTime), 12)}`,
    ...results.map(row => `${plain(String(row.operation ?? ''), 24).padEnd(24)} mean ${plain(shownOf(row.mean, ''), 12)} · p95 ${plain(shownOf(row.p95, ''), 12)} · p99 ${plain(shownOf(row.p99, ''), 12)} · ${plain(shownOf(row.improvement, ''), 24)}`),
  ]
}

/** `performance_report` (detailed): the current sample, and the stored history, whose latency feeds the sparkline. */
export const reportReader: Reader = (stdout, stderr, state) => {
  const result = recordOf(jsonAfter(stdout))
  const current = recordOf(result?.current)

  if (result === null || current === null) return mcpReader('performance_report')(stdout, stderr, state)

  const history = (Array.isArray(result.history) ? result.history : []).map(recordOf).flatMap(row => {
    const avg = recordOf(row?.latency)?.avg

    return msIn(avg) === undefined ? [] : [avg as number]
  })
  const memo = perfMemo(state)
  const cpu = recordOf(current.cpu) ?? {}
  const memory = recordOf(current.memory) ?? {}
  const latency = recordOf(current.latency) ?? {}

  memo.report = history.slice(-KEEP)
  memo.atMs = Date.now()

  return [
    `cpu ${share(cpu.usage, 100_000, 1)} of ${shownOf(cpu.cores)} cores · memory ${shownOf(memory.used)} of ${shownOf(memory.total)} MB · heap ${shownOf(memory.heap)} MB`,
    `latency avg ${ms(latency.avg)} · p50 ${ms(latency.p50)} · p95 ${ms(latency.p95)} · p99 ${ms(latency.p99)}`,
    `history: ${history.length} stored sample${history.length === 1 ? '' : 's'} in .claude-flow/performance/metrics.json`,
    ...labLines('performance_report', JSON.stringify({ trends: result.trends, recommendations: result.recommendations })).slice(0, 12),
  ]
}

const LOCAL = '$0, local: measures in-process and writes nothing'
const PROBE = '$0, local: writes and removes a 4 KB probe file in .claude-flow/performance/'

export const PERF: readonly PerfEntry[] = [
  { id: 'perf-metrics', name: 'METRICS', about: 'heap, rss, load and event-loop latency, now', label: 'performance metrics: memory, load and latency now', cost: 'read', args: ['performance', 'metrics', '--format', 'json'], read: metricsReader, note: LOCAL },
  { id: 'perf-profile', name: 'PROFILE', about: 'CPU, heap and event-loop lag over a short sample', label: 'performance profile: CPU, heap and lag over 1 s', cost: 'read', args: ['performance', 'profile', '--type', 'all', '--duration', '10'], read: (out, err) => textLines(out, err), note: LOCAL },
  { id: 'perf-bench-wasm', name: 'BENCH WASM', about: 'flash-attention batch search, 100 iterations', label: 'performance benchmark, wasm suite: pure compute', cost: 'read', args: ['performance', 'benchmark', '--suite', 'wasm', '--iterations', '100', '--output', 'json'], read: benchReader, note: LOCAL },
  { id: 'perf-bench-all', name: 'BENCH ALL', about: 'embeddings, search, flash attention, SONA, memory', label: 'performance benchmark, every suite (writes memory, may download a model)', cost: 'network', args: ['performance', 'benchmark', '--suite', 'all', '--iterations', '20', '--output', 'json'], read: benchReader, note: 'local CPU for a minute or more: stores entries in memory namespace benchmark, and the first embedding may download the transformers.js model (network)', timeoutMs: 300_000 },
  { id: 'perf-report', name: 'REPORT', about: 'a sample appended to the stored history, and trends', label: 'performance_report: sample, store and trend (writes metrics.json)', cost: 'writes', args: exec('performance_report', { format: 'detailed' }), read: reportReader, note: '$0, local: appends one sample to .claude-flow/performance/metrics.json (keeps 100)' },
  { id: 'perf-bottleneck', name: 'BOTTLENECK', about: 'measured disk, heap and benchmark-history hot spots', label: 'performance_bottleneck: measured hot spots', cost: 'writes', args: exec('performance_bottleneck', {}), read: mcpReader('performance_bottleneck'), note: PROBE },
  { id: 'perf-optimize', name: 'OPTIMIZE', about: 'measured recommendations, nothing aggressive applied', label: 'performance_optimize: measured recommendations', cost: 'writes', args: exec('performance_optimize', { target: 'all' }), read: mcpReader('performance_optimize'), note: PROBE },
]

/** Is a lab result one of this view's? */
export const isPerfResult = (id: string): boolean => PERF.some(entry => entry.id === id)
