/**
 * Asks Claude raises that are screened by AIDefence first (ask, ask-aside, mission-guide, mission-research) land after its tool call has
 * returned. They keep who asked and the level Claude had (ADR-450 T14), go through the same gate as any other ask of Claude's (T8), never
 * replace an action the person is about to confirm, and a Yes only runs the card it was pressed on (T17).
 * Real controller, runner, palette and model tools; only the engine is faked (fixtures/live-console.ts).
 */
import { describe, expect, it } from 'vitest'

import { callTool, classOf } from '../hooks/model-tools'
import { settingsOf } from '../hooks/settings'
import { flush, liveConsole } from './fixtures/live-console'

describe('a screened ask of Claude\'s is gated when it lands', () => {
  it('ask <question> at read: refused for its level, nothing is queued', async () => {
    const { deps, state, log } = liveConsole('read')
    const answer = await callTool('console_run', { id: 'ask', text: 'what next' }, deps)

    await flush()
    expect(answer).toMatch(/needs "full"/)
    expect(state.pending).toBeNull()
    expect(log.prompts).toEqual([])
  })

  it('mission-guide <text> at read: nothing is queued', async () => {
    const { deps, state } = liveConsole('read')

    await callTool('console_run', { id: 'mission-guide', text: 'push the branch now' }, deps)
    await flush()
    expect(state.pending).toBeNull()
  })

  it('ask <question> at full: the ask lands after the call returned, marked as Claude\'s with its class, and counted', async () => {
    const { deps, state } = liveConsole('full', 'ask')

    expect(await callTool('console_run', { id: 'ask', text: 'what next' }, deps)).not.toMatch(/^Refused/)
    // The screen has not answered yet: the call returned with nothing queued.
    expect(state.pending).toBeNull()

    await flush()
    const pending = state.pending

    // Its class is read as for any ask (at least a spend: it starts a billed turn), shown on the card and counted against the session budget.
    expect(pending).toMatchObject({ source: 'claude' })
    expect(['spend', 'delete']).toContain(pending?.kind)
    expect(pending?.kind).toBe(classOf(pending!))
    expect(state.control.used[pending?.kind ?? '']).toBe(1)
  })

  it('a level lowered while the screen looked wins: the ask is not queued', async () => {
    const { deps, state } = liveConsole('full', 'ask')

    await callTool('console_run', { id: 'ask', text: 'what next' }, deps)
    Object.assign(settingsOf(state).ai, { modelControl: 'read' })
    await flush()
    expect(state.pending).toBeNull()
  })

  it('Stop pressed while the screen looked: the ask is not queued', async () => {
    const { deps, state } = liveConsole('full', 'ask')

    await callTool('console_run', { id: 'mission-guide', text: 'carry on' }, deps)
    state.control.paused = true
    await flush()
    expect(state.pending).toBeNull()
    // A refused ask is not counted against the session budget.
    expect(state.control.used).toEqual({})
  })

  it('the person\'s own ask, screened the same way, is still theirs', async () => {
    const { control, state } = liveConsole('read')

    expect(control.runner.runById('ask', 'what next')).toBe(true)
    await flush()
    expect(state.pending).toMatchObject({ source: 'you' })
  })
})

describe('the person\'s waiting action is theirs (ADR-450 T17)', () => {
  it('a screened Claude ask does not replace the card the person is about to confirm', async () => {
    const { state, deps, control, log } = liveConsole('full', 'ask')

    expect(await callTool('console_run', { id: 'ask', text: 'what next' }, deps)).not.toMatch(/^Refused/)
    // Before the screen answers, the person raises their own action and reads its card.
    control.runner.ask({ label: 'store my note', args: ['memory', 'store', '--key', 'k', '--value', 'mine'], expect: 'stored' }, 'x')
    const shown = state.pending

    await flush()
    expect(state.pending).toBe(shown)

    await control.runner.confirm(shown?.id)
    expect(log.runs.some(argv => argv.includes('store') && argv.includes('mine'))).toBe(true)
    expect(log.prompts).toEqual([])
  })

  it('a Yes pressed on a card that has since been replaced runs nothing, and the new card stays', async () => {
    const { state, control, log } = liveConsole('read')

    control.runner.ask({ label: 'store note one', args: ['memory', 'store', '--key', 'a', '--value', 'one'], expect: 'stored' }, 'x')
    const seen = state.pending?.id

    control.runner.ask({ label: 'store note two', args: ['memory', 'store', '--key', 'b', '--value', 'two'], expect: 'stored' }, 'x')
    await control.runner.confirm(seen)
    expect(log.runs.filter(argv => argv.includes('store'))).toEqual([])
    expect(state.pending?.label).toBe('store note two')

    await control.runner.confirm(state.pending?.id)
    expect(log.runs.filter(argv => argv.includes('two')).length).toBe(1)
  })
})
