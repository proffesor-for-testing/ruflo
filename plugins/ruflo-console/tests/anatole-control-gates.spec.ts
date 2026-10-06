/**
 * Project Anatole's palette entries (ADR-453 §9) when Claude calls them through console_run: the classes anatole.ts gives them (edits write,
 * enforce install, reset delete, run and replay local reads) hold end to end through the level, the confirm and the card id (ADR-450 T8,
 * T17). The person's own clicks are unchanged: each change asks them, then sends.
 * Real controller, runner, palette and model tools; only the engine is faked (fixtures/live-console.ts).
 */
import { describe, expect, it } from 'vitest'

import { wireAnatole } from '../hooks/anatole'
import { callTool } from '../hooks/model-tools'
import { flush, liveConsole } from './fixtures/live-console'

const FP = 'abcdef012345'

function anatoleConsole(level: 'read' | 'write' | 'manage' | 'full', confirm: 'ask' | 'auto' = 'ask') {
  const live = liveConsole(level, confirm)

  wireAnatole(live.state, live.host)

  return live
}

const CHANGES: ReadonlyArray<readonly [string, string, string]> = [
  ['anatole-mode', 'off', 'mode off'],
  ['anatole-mode', 'learn', 'mode learn'],
  ['anatole-mode', 'notify', 'mode notify'],
  ['anatole-rule', 'PR-002 off', 'rule PR-002 off'],
  ['anatole-ack', 'a1', 'ack a1'],
  ['anatole-allow', FP, `allow ${FP}`],
]

describe('Claude\'s Anatole calls go through the same gate as every other entry', () => {
  for (const [id, text] of CHANGES) {
    it(`${id} ${text} at read is refused as a write action, and nothing reaches the mod`, async () => {
      const { deps, log, state } = anatoleConsole('read', 'auto')
      const answer = await callTool('console_run', { id, text }, deps)

      await flush()
      expect(answer).toMatch(/is a write action.*needs "write"/)
      expect(log.slash).toEqual([])
      expect(state.pending).toBeNull()
    })
  }

  it('anatole-rule at write:ask waits for the person, as Claude\'s, then their Yes on that card sends it', async () => {
    const { deps, log, state, control } = anatoleConsole('write', 'ask')
    const answer = await callTool('console_run', { id: 'anatole-rule', text: 'PR-002 off' }, deps)

    await flush()
    expect(answer).toMatch(/^Waiting for the person to confirm/)
    expect(state.pending).toMatchObject({ source: 'claude', kind: 'write' })
    expect(typeof state.pending?.id).toBe('number')
    expect(log.slash).toEqual([])

    await control.runner.confirm(state.pending?.id)
    await control.runner.finished()
    expect(log.slash).toEqual([['protector', 'rule PR-002 off']])
  })

  it('anatole-mode enforce (install) is refused at manage, and at full:auto still waits for the person', async () => {
    const low = anatoleConsole('manage', 'auto')

    expect(await callTool('console_run', { id: 'anatole-mode', text: 'enforce' }, low.deps)).toMatch(/is a install action.*needs "full"/)

    const high = anatoleConsole('full', 'auto')

    expect(await callTool('console_run', { id: 'anatole-mode', text: 'enforce' }, high.deps)).toMatch(/^Waiting for the person to confirm/)
    expect(high.state.pending).toMatchObject({ source: 'claude', kind: 'install' })
    await flush()
    expect([...low.log.slash, ...high.log.slash]).toEqual([])
  })

  it('anatole-reset (delete) is refused at manage', async () => {
    const { deps, log } = anatoleConsole('manage', 'auto')

    expect(await callTool('console_run', { id: 'anatole-reset' }, deps)).toMatch(/is a delete action/)
    await flush()
    expect(log.slash).toEqual([])
  })

  it('Claude never replaces the person\'s waiting Anatole card', async () => {
    const { control, deps, log, state } = anatoleConsole('full', 'auto')

    control.runner.runById('anatole-mode', 'learn')
    const mine = state.pending?.id

    await callTool('console_run', { id: 'anatole-mode', text: 'off' }, deps)
    await flush()
    expect(state.pending).toMatchObject({ id: mine, source: 'you', label: 'Anatole mode learn' })
    expect(log.slash).toEqual([])
  })

  it('anatole-run and anatole-replay, local reads, still run at once at read', async () => {
    const { deps, log, state } = anatoleConsole('read')

    for (const id of ['anatole-run', 'anatole-replay']) expect(await callTool('console_run', { id }, deps)).not.toMatch(/^(Refused|Waiting)/)
    await flush()
    expect(log.slash).toEqual([['protector', 'run'], ['protector', 'replay']])
    expect(state.pending).toBeNull()
  })
})

describe('the person\'s own Anatole clicks are unchanged', () => {
  for (const [id, text, slash] of CHANGES) {
    it(`${id} ${text}: asks the person, whatever Claude's level, and their Yes sends /protector ${slash}`, async () => {
      const { control, log, state } = anatoleConsole('read')

      expect(control.runner.runById(id, text)).toBe(true)
      expect(state.pending).toMatchObject({ source: 'you' })
      expect(state.pending?.kind).toBeUndefined()
      expect(log.slash).toEqual([])

      await control.runner.confirm(state.pending?.id)
      await control.runner.finished()
      expect(log.slash).toEqual([['protector', slash]])
    })
  }
})
