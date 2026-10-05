/**
 * What console_state hands the model from the terminal page: an x.ruv.io invite code minted there (a bearer secret, xruv.ts
 * INVITE_COMMAND) is masked in the scrollback itself, and a line holding any other secret shape is withheld whole. Real code
 * paths: the ruflo harness runs the INVITES row's command through a fake spawn, then callTool reads the console.
 */
import { describe, expect, it } from 'vitest'

import { send, termText } from '../hooks/harness'
import type { Host } from '../hooks/host'
import { callTool, type ModelToolDeps } from '../hooks/model-tools'
import { settingsOf } from '../hooks/settings'
import { newState, type State } from '../hooks/state'
import { INVITE_COMMAND, maskInvites } from '../hooks/xruv'

const CODE = 'v2.Zk3pQ9rT_u7WmB2xL0aYc4N'
// Built at run time so no token-shaped literal sits in this source.
const TOKEN = `ghp_${'Ab3'.repeat(12)}`

function fakeSpawn(stdout: string) {
  return (_argv: readonly string[]) => {
    const stream = (async function* () {
      yield { stream: 'stdout', text: stdout }

      return { code: 0, signal: null }
    })()

    return Object.assign(stream, { result: Promise.resolve({ code: 0, signal: null }), return: async () => ({ done: true, value: undefined }) }) as never
  }
}

/** Every action is a no-op: the view only needs the closures to exist. */
const deepNoop = (): unknown => new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : deepNoop()) })

const settled = async (state: State) => {
  for (let i = 0; i < 100 && (state.terminal.runs.size > 0 || i < 2); i++) await new Promise(resolve => setTimeout(resolve, 2))
}

/** Runs one ruflo command whose output is `stdout`, opens the terminal page as the model, and returns what console_state answers. */
async function stateAfter(command: string, stdout: string): Promise<{ state: State; answer: string }> {
  const state = newState({})
  const host = { spawn: fakeSpawn(stdout), invalidate: () => undefined, after: () => ({ cancel: () => undefined }), storeSet: async () => undefined, focus: async () => undefined } as unknown as Host

  state.terminal.harness = 'ruflo'
  send(state, host, command)
  await settled(state)

  expect(settingsOf(state).ai.modelControl).toBe('read')
  const control = { host, setView: (view: State['view']) => void (state.view = view), open: async () => undefined, actions: deepNoop(), runner: {} }
  const deps = { state, control } as unknown as ModelToolDeps

  expect(await callTool('console_open', { view: 'terminal' }, deps)).toMatch(/^Opened/)

  return { state, answer: await callTool('console_state', {}, deps) }
}

describe('console_state never carries a secret from the terminal', () => {
  it('a minted invite code is masked in the scrollback and never reaches the model', async () => {
    const { state, answer } = await stateAfter(INVITE_COMMAND, `[OK] Invite minted\n{\n  "code": "${CODE}",\n  "maxUses": 25\n}\n`)

    expect(state.terminal.lines.some(line => line.text.includes(CODE))).toBe(false)
    expect(state.terminal.lines.some(line => line.text.includes('invite code, masked'))).toBe(true)
    expect(answer).not.toContain(CODE)
    expect(answer).toContain('maxUses')
  })

  it('a line with a token in it is withheld from the model whole, and the lines around it are not', async () => {
    const { answer } = await stateAfter('config get', `before the token\nexport GITHUB_TOKEN=${TOKEN}\nafter the token\n`)

    expect(answer).not.toContain(TOKEN)
    expect(answer).toContain('looks like a secret: not shown')
    expect(answer).toContain('before the token')
    expect(answer).toContain('after the token')
  })

  it('a version with the invite prefix stays readable', () => {
    expect(maskInvites('upgraded to v2.1.0-beta.3')).toBe('upgraded to v2.1.0-beta.3')
    expect(termText(`code ${CODE} here`)).toBe('code v2.•••• (invite code, masked) here')
  })
})
