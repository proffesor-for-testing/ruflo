/**
 * Bounds for numbers another process wrote. A finite number is not yet a drawable one: a millisecond value beyond Date's range makes
 * toISOString() throw (one bad timestamp would take a whole page down), and a hostile count draws as 1e+302M or -Infinity%.
 */

/** Date's own range (ECMA-262 TimeClip): a finite millisecond value beyond it is an Invalid Date. */
export const MAX_DATE_MS = 8.64e15
/** The largest count kept as a number: a hostile 1e300 is held here, never drawn in exponent notation. */
export const COUNT_CEILING = Number.MAX_SAFE_INTEGER

/** Epoch milliseconds inside Date's range and after the epoch, or undefined. */
export const dateMsOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_DATE_MS ? value : undefined)

/** The ISO text of a millisecond value, or undefined when Date cannot hold it (never throws). */
export const isoOf = (ms: number | null | undefined): string | undefined => (typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) <= MAX_DATE_MS ? new Date(ms).toISOString() : undefined)

/** A whole, non-negative count no larger than the ceiling, or undefined for anything else (negative, NaN, a string). */
export const countOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), COUNT_CEILING) : undefined)

/** The largest money amount kept, in minor units (cents): ten trillion dollars. Past it a value is not a budget but a hostile number. */
export const MINOR_CEILING = 1e15

/**
 * A money amount in minor units: whole, non-negative and no larger than the ceiling, or undefined (drawn as n/a). A budget, a
 * reservation or a settlement is never negative in ADR-406, so a negative amount is refused rather than drawn as `$-0.01`.
 */
export const minorOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MINOR_CEILING ? value : undefined)

/** A share held to 0..1, or undefined for a value that is not a finite number. */
export const ratioOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined)

/** A finite number inside [min, max], or undefined: for a value with a known range that is neither a count nor a share (a score, a lift, a latency). */
export const finiteIn = (value: unknown, min: number, max: number): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined)

/** The largest dollar amount drawn from a report (a run's cost, a ledger total, a research spend): a billion. Past it the figure is hostile. */
export const USD_CEILING = 1e9

/** A dollar amount from a report: finite, non-negative and no larger than the ceiling, or undefined (drawn as n/a). */
export const usdOf = (value: unknown): number | undefined => finiteIn(value, 0, USD_CEILING)

/** Six places: the precision the console's own config form accepts (configValueOf), and the last before String() turns to exponents. */
const placed = (value: number): number => Math.round(value * 1e6) / 1e6

/**
 * A number as text at `places` decimals, except that a non-zero value too small to show there reads "<0.000001" (or ">-0.000001"),
 * never 0: the CLI writes such values itself (embeddings_init stores hyperbolic.epsilon 1e-15), and 0 would be a false reading.
 */
const placedText = (value: number, places = 6): string => {
  const step = 10 ** -places

  if (value !== 0 && Math.abs(value) < step) return `${value > 0 ? '<' : '>-'}${step.toFixed(places)}`

  return String(Number((Math.round(value / step) * step).toFixed(places)) || 0)
}

/**
 * A field a lab reader prints as written: a string or boolean as text, a number only when finite and within ±1e15 (to six places, so
 * 12.3456789 reads 12.345679, 1e-15 reads <0.000001 and 1e308 never draws), anything else the fallback.
 */
export const shownOf = (value: unknown, fallback = 'n/a'): string =>
  typeof value === 'string' || typeof value === 'boolean' ? String(value) : typeof value === 'number' ? (finiteIn(value, -1e15, 1e15) === undefined ? 'n/a' : placedText(value)) : fallback

/** A measured amount that is never negative (a duration, a size in MB, a time in ms): within 0..1e15, three places, else `fallback`. */
export const measureOf = (value: unknown, fallback = 'n/a'): string => (finiteIn(value, 0, 1e15) === undefined ? fallback : placedText(value as number, 3))

/**
 * A JSON value as text with every number bounded as shownOf bounds it (1e308 reads "n/a", 12.3456789 reads 12.345679, a non-zero
 * value below a millionth reads "<0.000001"): for a value a reader shows whole (a stored memory entry, a config value).
 */
export const boundedJson = (value: unknown, space?: number): string | undefined =>
  JSON.stringify(value, (_key, field: unknown) => (typeof field !== 'number' ? field : finiteIn(field, -1e15, 1e15) === undefined ? 'n/a' : field !== 0 && Math.abs(field) < 1e-6 ? placedText(field) : placed(field)), space)
