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

/** A share held to 0..1, or undefined for a value that is not a finite number. */
export const ratioOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined)
