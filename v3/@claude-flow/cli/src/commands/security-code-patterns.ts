/**
 * Line patterns for `security scan` phase 3, and what each line is tested on.
 *
 * The patterns are a heuristic, so each one is narrowed only where a false positive was seen on a real tree, and only
 * by a shape that is safe on its face:
 *  - eval needs a word start: "retrieval (" in prose is not a call; `window.eval(` still is.
 *  - command injection is any exec, execSync or execFile use (a call, `?.(`, `.call`/`.apply`/`.bind`, `['exec']`),
 *    except execFile of a literal non-shell program with a literal argv array and no `shell` key on the line. The old
 *    `exec[^S]` matched every execFile and the word in comments, and skipped execSync.
 *  - a pg placeholder `$${paramCount + 1}` is a parameter number, not a value in the SQL text. Exempt only when the
 *    expression is a number, a loop letter, an `.length`, or a name ending in Count/Index/Idx/Num/Pos, and the
 *    placeholder is not inside a quoted SQL string; `'$${name}'`, `$${userInput}` and `'x $${discount} y'` are reported.
 *  - comment text is removed before matching, not whole lines: code after a closing `*` + `/`, a generator method
 *    `* run()` and JSX continuation lines are still scanned.
 */

export type CodePattern = {
  /** Tested on one comment-stripped line. */
  match: (line: string) => boolean
  type: string
  severity: 'high' | 'medium'
  desc: string
}

/** No `g` flag, so `test` keeps no lastIndex between lines. */
const re = (pattern: RegExp) => (line: string) => pattern.test(line)

const SHELL_PROGRAM = /^(?:.*[\\/])?(?:sh|bash|zsh|dash|ksh|fish|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh)$/i
// Every use of an exec function on a line, as a call or a value; `{ execFile }` in a destructure is a name, not a use.
const EXEC_ANY = /\bexec\w*\b(?!\s*[A-Za-z_$}:,])|\[\s*['"`]exec/g
const EXEC_USE = /child_process.*(?:\bexec(?:Sync|File|FileSync)?\b\s*(?:\(|\?\.\s*\(|\.(?:call|apply|bind)\b)|\[\s*['"`]exec\w*['"`]\s*\]|\.exec(?:Sync|File|FileSync)?\b(?!\s*[A-Za-z_$]))/
// A literal program, a literal argv array (nothing chained on it), then the end of the call, an options object literal
// with no computed key, or a callback. An options variable could carry `shell: true`, so it is not plain.
const PLAIN_EXEC_FILE = /\bexecFile(?:Sync)?\s*\(\s*(['"`])([^'"`$]+)\1\s*,\s*\[[^\][]*\]\s*(?:\)|,\s*\{(?:(?!\.\.\.)[^{}[\]])*\}\s*[,)]|,\s*(?:\((?:\s*[A-Za-z_$][\w$]*\s*,?)*\)\s*=>|function\b|async\b|[A-Za-z_$][\w$]*\s*=>))/

/** execFile of a literal, non-shell program with a literal argv array, and no `shell` anywhere on the line. */
const isPlainExecFile = (line: string): boolean => {
  const call = PLAIN_EXEC_FILE.exec(line)
  if (call === null || /shell/i.test(line) || SHELL_PROGRAM.test(call[2])) return false
  // Every exec use on the line must be that one call: `exec(x); execFile('git', [...])` is still reported.
  return (line.match(EXEC_ANY) ?? []).length === 1
}

const commandInjection = (line: string): boolean => EXEC_USE.test(line) && !isPlainExecFile(line)

const COUNTER = /^\s*(?:\d+|[ijkn]|[\w$.]+\.length|(?:[A-Za-z_$][\w$]*[a-z0-9])?(?:Count|Index|Idx|Num|Pos)|count|index|idx|num|pos)\s*(?:[+-]\s*\d+\s*)?$/
// Where a pg parameter stands in SQL: after a comparison, a list or call opener, or a clause keyword.
const PARAM_BEFORE = /(?:[=<>(,]|\b(?:LIMIT|OFFSET|IN|VALUES|BETWEEN|AND|OR|LIKE|ILIKE|SET|BY|THEN|ELSE|WHEN|IS))\s*$/i
const PARAM_AFTER = /^(?:\s|[,);]|::|$|`)/

/**
 * `$${paramCount}` / `LIMIT $${params.length + 1}`: the pg parameter number where SQL takes a value, not interpolated
 * SQL text. `'$${n}'`, `"$${n}"`, `$${userInput}` and `x $${discount}` keep their interpolation.
 */
export const withoutPlaceholders = (line: string): string =>
  line.replace(/\$\$\{([^}]*)\}/g, (match, expr: string, at: number) =>
    COUNTER.test(expr) && PARAM_BEFORE.test(line.slice(Math.max(0, at - 16), at)) && PARAM_AFTER.test(line.slice(at + match.length)) && !inSqlQuote(line, at) ? '' : match)

/** An odd count of `'` between the template literal's opening backtick and `at`: inside a quoted SQL string. */
const inSqlQuote = (line: string, at: number): boolean =>
  (line.slice(line.lastIndexOf('`', at) + 1, at).match(/'/g) ?? []).length % 2 === 1

/** The old `/\$\{.*\}.*sql|sql.*\$\{/i`, in linear time: a long minified line made the regex quadratic. */
const sqlInterpolation = (line: string): boolean => {
  const lower = line.toLowerCase()
  const open = line.indexOf('${')
  const close = open < 0 ? -1 : line.indexOf('}', open + 2)
  if (close >= 0 && lower.indexOf('sql', close + 1) >= 0) return true
  const sql = lower.indexOf('sql')
  return sql >= 0 && line.indexOf('${', sql + 3) >= 0
}

export const CODE_PATTERNS: readonly CodePattern[] = [
  { match: re(/(?<![\w$])eval\s*\(/), type: 'Eval Usage', severity: 'medium', desc: 'eval() can execute arbitrary code' },
  { match: re(/innerHTML\s*=/), type: 'innerHTML', severity: 'medium', desc: 'XSS risk with innerHTML' },
  { match: re(/dangerouslySetInnerHTML/), type: 'React XSS', severity: 'medium', desc: 'React XSS risk' },
  { match: commandInjection, type: 'Command Injection', severity: 'high', desc: 'Possible command injection' },
  { match: line => sqlInterpolation(line) && sqlInterpolation(withoutPlaceholders(line)), type: 'SQL Injection', severity: 'high', desc: 'Possible SQL injection' },
]

/**
 * The file's lines with comment text blanked (line count kept, so locations stay right). Strings are respected, so
 * `'http://x'` is not a comment; a template literal may span lines. Regex literals and JSX text are not parsed, so a
 * `//` or `/*` inside one is taken as a comment. That can only hide the rest of that one line: a block comment carries
 * to the next lines only when its `/*` starts the line, which a regex or JSX text never does.
 */
export function codeLinesOf(content: string): string[] {
  const out: string[] = []
  let inBlock = false
  let inTemplate = false

  let offset = 0

  for (const line of content.split('\n')) {
    let code = ''
    let quote: string | null = inTemplate ? '`' : null
    let carries = inBlock

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      const next = line[i + 1]

      if (inBlock) {
        if (ch === '*' && next === '/') { inBlock = false; i++; code += ' ' }
        continue
      }
      if (ch === '\\') { code += ch + (next ?? ''); i++; continue }
      if (quote !== null) {
        if (ch === quote) quote = null
        code += ch
        continue
      }
      if (ch === '/' && next === '/') break
      if (ch === '/' && next === '*') {
        inBlock = true
        // Carried past this line only from a line-start opener that is closed later in the file: JSX text or a regex
        // never starts a line with an unclosed comment, so neither can blank the lines after it.
        carries = code.trim() === '' && content.indexOf('*/', offset + i + 2) >= 0
        i++
        code += ' '
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch
      code += ch
    }

    if (inBlock && !carries) inBlock = false
    inTemplate = quote === '`'
    out.push(code)
    offset += line.length + 1
  }

  return out
}

/**
 * Generated report assets, named by what the report writes, inside a folder its marker file identifies. Only those
 * entries are skipped: other files in a folder that merely shares the name are still scanned.
 */
const REPORT_ASSETS = new Map<string, { markers: readonly string[]; assets: ReadonlySet<string> }>([
  ['coverage', { markers: ['coverage-final.json', 'lcov.info', 'clover.xml'], assets: new Set(['prettify.js', 'sorter.js', 'block-navigation.js', 'lcov-report']) }],
  ['playwright-report', { markers: ['index.html'], assets: new Set(['trace', 'data']) }],
])

/** True for an istanbul or Playwright asset, given its parent folder's name and what the parent folder holds. */
export function isGeneratedReportAsset(parentName: string, entryName: string, parentHas: (name: string) => boolean): boolean {
  // A Map, so a folder named `constructor` or `__proto__` is not looked up on Object.prototype.
  const report = REPORT_ASSETS.get(parentName)
  return report !== undefined && report.assets.has(entryName) && report.markers.some(parentHas)
}
