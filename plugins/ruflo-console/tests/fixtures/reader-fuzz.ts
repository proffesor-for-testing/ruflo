/**
 * A reader's JSON shape, learned from the reader itself: the document handed to it is wrapped in a Proxy that records every key the
 * reader reads, at every depth. A key it asked for and the document lacked is offered next round as an object, then as a one-element
 * array, then as a number, until the reader stops asking. So the keys come from the reader's code, not from a list kept beside it, and
 * a reader added later is fed its own keys without anyone writing them down.
 */

type Kind = 'probe-obj' | 'probe-arr' | 'obj' | 'arr' | 'arr-leaf' | 'leaf'
/** `fresh`: not yet offered to the reader in a document, so not yet judged by what it read. */
type ShapeNode = { kind: Kind; children: Map<string, ShapeNode>; elem: ShapeNode | null; touched: boolean; indexed: boolean; fresh: boolean }

export type Wrap = 'plain' | 'array' | 'mcp'
export type Shape = { root: ShapeNode; wrap: Wrap; keys: number }

const node = (kind: Kind): ShapeNode => ({ kind, children: new Map(), elem: null, touched: false, indexed: false, fresh: true })
/** Keys every object answers that say nothing about the document's shape. */
const IGNORED = new Set(['toJSON', 'then', 'constructor', 'length', 'valueOf', 'toString', 'toLocaleString', '__proto__', 'hasOwnProperty'])
const MAX_DEPTH = 6

function build(at: ShapeNode, n: number, depth = 0): unknown {
  switch (at.kind) {
    case 'leaf':
      return n
    case 'arr-leaf':
      return [n, n, n]
    case 'probe-obj':
      return {}
    case 'probe-arr':
      return [{}]
    case 'arr':
      return [build(at.elem ?? node('probe-obj'), n, depth + 1)]
    case 'obj':
      return depth > MAX_DEPTH ? n : Object.fromEntries([...at.children].map(([key, child]) => [key, build(child, n, depth + 1)]))
  }
}

/** Each watching proxy's own document, so JSON.stringify of one (which walks every element) is not taken for the reader reading them. */
const targets = new WeakMap<object, object>()

/** The document wrapped so every read is recorded on the node it came from. */
function watch(value: unknown, at: ShapeNode): unknown {
  if (value === null || typeof value !== 'object') return value

  const proxy = new Proxy(value as object, {
    get(target, key, receiver) {
      const raw = Reflect.get(target, key, receiver)

      // Turning an array into text (String(x), `${x}`) walks its elements: that is not the reader reading an element.
      if (Array.isArray(target) && (key === 'join' || key === 'toString' || key === 'toLocaleString')) return (...args: unknown[]) => (Array.prototype[key] as (...a: unknown[]) => string).apply(target, args)
      if (typeof key !== 'string' || IGNORED.has(key)) return raw
      if (Array.isArray(target)) {
        if (!/^\d+$/.test(key)) return raw
        at.indexed = true
        at.elem ??= node('probe-obj')

        return watch(raw, at.elem)
      }
      at.touched = true
      if (!at.children.has(key)) at.children.set(key, node('probe-obj'))

      return watch(raw, at.children.get(key) as ShapeNode)
    },
    has(target, key) {
      if (typeof key === 'string' && !Array.isArray(target) && !IGNORED.has(key)) {
        at.touched = true
        if (!at.children.has(key)) at.children.set(key, node('probe-obj'))
      }

      return Reflect.has(target, key)
    },
  })

  targets.set(proxy, value as object)

  return proxy
}

/** Moves each probed node one step on: an object nobody read into is tried as an array, an array nobody indexed is a number. */
function settle(at: ShapeNode, depth = 0): boolean {
  let changed = false

  if (at.fresh) {
    at.fresh = false
    changed = at.kind === 'probe-obj' || at.kind === 'probe-arr'
  } else if (at.kind === 'probe-obj') {
    at.kind = at.touched && depth <= MAX_DEPTH ? 'obj' : 'probe-arr'
    changed = true
  } else if (at.kind === 'probe-arr') {
    at.kind = at.elem !== null && at.elem.touched && depth <= MAX_DEPTH ? 'arr' : at.indexed ? 'arr-leaf' : 'leaf'
    if (at.kind === 'arr' && at.elem !== null) Object.assign(at.elem, { kind: 'obj', fresh: false })
    if (at.kind !== 'arr') at.elem = null
    changed = true
  }
  for (const child of at.children.values()) changed = settle(child, depth + 1) || changed
  if (at.kind === 'arr' && at.elem !== null) changed = settle(at.elem, depth + 1) || changed
  at.touched = at.kind === 'obj' ? at.touched : false

  return changed
}

const countKeys = (at: ShapeNode): number => at.children.size + [...at.children.values()].reduce((sum, child) => sum + countKeys(child), 0) + (at.elem === null ? 0 : countKeys(at.elem))

/** The JSON text of a document, as the CLI would print it in that wrap. */
export function stdoutOf(doc: unknown, wrap: Wrap): { stdout: string; json: string } {
  const json = JSON.stringify(wrap === 'array' ? [doc] : doc)

  return { json, stdout: wrap === 'mcp' ? `[INFO] Executing tool: x\n\nResult:\n${JSON.stringify({ content: [{ type: 'text', text: json }] })}\n` : json }
}

/**
 * Learns a reader's shape: feeds it a document, records what it read, and grows the document until nothing new is asked (or the
 * rounds run out). `run` must call the reader with the stdout it is given.
 */
export function learnShape(run: (stdout: string) => void, wrap: Wrap, rounds = 24): Shape {
  const root = { ...node('obj'), fresh: false }
  const parse = JSON.parse
  const stringify = JSON.stringify

  for (let round = 0; round < rounds; round++) {
    const { stdout, json } = stdoutOf(build(root, 1), wrap)

    JSON.parse = ((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
      const value: unknown = parse(text, reviver)

      if (text !== json) return value

      return wrap === 'array' && Array.isArray(value) ? [watch(value[0], root)] : watch(value, root)
    }) as typeof JSON.parse
    JSON.stringify = ((value: unknown, ...rest: unknown[]) => (stringify as (...a: unknown[]) => string)(typeof value === 'object' && value !== null ? (targets.get(value) ?? value) : value, ...rest)) as typeof JSON.stringify
    try {
      run(stdout)
    } catch {
      // A throw is the sweep's to report, on the hostile document: here only the keys matter.
    } finally {
      JSON.parse = parse
      JSON.stringify = stringify
    }
    if (!settle(root)) break
  }

  return { root, wrap, keys: countKeys(root) }
}

/** The learned document with every number set to `n`. */
export const hostileOf = (shape: Shape, n: number): string => stdoutOf(build(shape.root, n), shape.wrap).stdout
