/**
 * One line of console text as the model reads it (ADR-450). Its own module so every place that answers the model (model-tools.ts, and the
 * refusals in control-policy.ts that runner.ts and model-tools.ts both return) cleans text the same way, without control-policy.ts having
 * to import the model tools.
 */
import { ESCAPES, plain } from './data/parse'
import { hasSecret } from './screen'
import { maskInvites } from './xruv'

// Control (bar tab and line breaks; escape sequences go first), zero-width, bidi and other format characters: nothing a person
// reads, and enough to split a code so a pattern misses it.
export const INVISIBLE = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff9-\\ufffb]|[\\u{e0000}-\\u{e0fff}]', 'gu')

export const SECRET_LINE = '(a line that looks like a secret: not shown)'

/** One line of console text as the model reads it: plain, any invite code masked, and withheld whole when it holds a secret shape. */
export const modelLine = (line: string, max: number): string => {
  // Invisible characters go first (not to a space, as plain() does), and codes are masked before the cut too, so an invite split
  // by a zero-width character or cut by the length limit is still masked.
  const joined = line.replace(ESCAPES, '').replace(INVISIBLE, '')
  const text = maskInvites(plain(maskInvites(joined), max))

  return hasSecret(line) || hasSecret(joined) || hasSecret(text) ? SECRET_LINE : text
}
