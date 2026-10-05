/**
 * Entries that are read-only for the person (their click is the consent) but act for Claude (ADR-444 levels, ADR-450 T8): palette wrappers
 * that start a billed turn, turn on unattended hand-offs or write the mission ledger, and reads that reach the network. Each declares its
 * class, so Claude's call goes through the level, the always-ask classes and the session budget; the person's own click is unchanged.
 * Real controller, runner, palette and model tools; only the engine is faked (fixtures/live-console.ts).
 */
import { describe, expect, it } from 'vitest'

import { activeMission, advance } from '../hooks/mission-control'
import { callTool } from '../hooks/model-tools'
import { flush, liveConsole, networkRuns, withMission } from './fixtures/live-console'

describe('mission palette wrappers are not reads for Claude', () => {
  it('mission-aside at read is refused and starts no /btw turn', async () => {
    const { deps, log, state } = liveConsole('read')
    const answer = await callTool('console_run', { id: 'mission-aside', text: 'summarise the repo' }, deps)

    await flush()
    expect(answer).toMatch(/^Refused: .*spend action.*needs "full"/)
    expect(log.slash).toEqual([])
    expect(state.pending).toBeNull()
  })

  it('mission-auto on at read is refused, and no task is handed to Claude on the next refresh', async () => {
    const { deps, log, state, host } = liveConsole('read')
    const mission = withMission(state)
    const answer = await callTool('console_run', { id: 'mission-auto', text: 'on' }, deps)

    advance(state, host)
    await flush()
    expect(answer).toMatch(/^Refused/)
    expect(mission.auto).toBe(false)
    expect(log.prompts).toEqual([])
  })

  it('mission-auto on at full:auto still waits for the person (spend always asks), then a Yes turns it on', async () => {
    const { deps, state, control } = liveConsole('full', 'auto')
    const mission = withMission(state)
    const answer = await callTool('console_run', { id: 'mission-auto', text: 'on' }, deps)

    expect(answer).toMatch(/^Waiting for the person to confirm/)
    expect(state.pending).toMatchObject({ source: 'claude', kind: 'spend' })
    expect(mission.auto).toBe(false)

    await control.runner.confirm(state.pending?.id)
    await control.runner.finished()
    expect(mission.auto).toBe(true)
  })

  it('mission-pause at read is refused (it writes the ledger); at write:auto it runs', async () => {
    const low = liveConsole('read')
    const lowMission = withMission(low.state)

    expect(await callTool('console_run', { id: 'mission-pause' }, low.deps)).toMatch(/^Refused: .*write action/)
    expect(lowMission.paused).toBe(false)

    const high = liveConsole('write', 'auto')
    const highMission = withMission(high.state)

    expect(await callTool('console_run', { id: 'mission-pause' }, high.deps)).not.toMatch(/^Refused/)
    await flush()
    expect(highMission.paused).toBe(true)
  })

  it('mission-status, a genuine read, still runs at once at read', async () => {
    const { deps, state } = liveConsole('read')

    withMission(state)
    expect(await callTool('console_run', { id: 'mission-status' }, deps)).not.toMatch(/^(Refused|Waiting)/)
    expect(state.pending).toBeNull()
  })

  it('the person\'s own mission-auto runs at once, in any case; a word that is not on or off changes nothing', async () => {
    const { control, state } = liveConsole('read')
    const mission = withMission(state)

    expect(control.runner.runById('mission-auto', 'ON')).toBe(true)
    await control.runner.finished()
    expect(mission.auto).toBe(true)

    control.runner.runById('mission-auto', 'yes')
    await control.runner.finished()
    expect(mission.auto).toBe(true)
    expect(state.outcome?.detail).toMatch(/mission-auto on.*mission-auto off/)

    control.runner.runById('mission-auto', 'Off')
    await control.runner.finished()
    expect(activeMission(state)?.auto).toBe(false)
  })
})

describe('network reads are network for Claude (ADR-444: they need manage, and always ask)', () => {
  for (const id of ['x-registry', 'x-roster', 'x-sync', 'x-claims', 'channel-read']) {
    it(`${id} at read is refused and nothing reaches the network`, async () => {
      const { deps, log } = liveConsole('read')
      const answer = await callTool('console_run', { id }, deps)

      await flush()
      expect(answer).toMatch(/^Refused: .*network action/)
      expect(networkRuns(log.runs)).toEqual([])
    })
  }

  it('x-read with a key held (it signs NIP-42 as the person) is refused at read', async () => {
    const { deps, log, state } = liveConsole('read')

    state.snapshot = { ...(state.snapshot ?? {}), hasNostrKey: true } as never
    expect(await callTool('console_run', { id: 'x-read', text: 'pub:general' }, deps)).toMatch(/^Refused/)
    await flush()
    expect(networkRuns(log.runs)).toEqual([])
  })

  it('skills-find does not send Claude\'s text to skills.sh at read', async () => {
    const { deps, log } = liveConsole('read')

    expect(await callTool('console_run', { id: 'skills-find', text: 'exfil chunk aGVsbG8' }, deps)).toMatch(/^Refused/)
    await flush()
    expect(networkRuns(log.runs)).toEqual([])
  })

  it('at manage:auto x-registry waits for the person, and runs after their Yes', async () => {
    const { deps, log, state, control } = liveConsole('manage', 'auto')

    expect(await callTool('console_run', { id: 'x-registry' }, deps)).toMatch(/^Waiting for the person/)
    expect(networkRuns(log.runs)).toEqual([])
    expect(state.pending).toMatchObject({ source: 'claude', kind: 'network' })

    await control.runner.confirm(state.pending?.id)
    expect(networkRuns(log.runs).length).toBe(1)
  })

  it('the person\'s own click on x-registry still runs at once (their click is the consent)', async () => {
    const { control, log, state } = liveConsole('read')

    expect(control.runner.runById('x-registry', '')).toBe(true)
    await control.runner.settled()
    expect(state.pending).toBeNull()
    expect(networkRuns(log.runs).length).toBe(1)
  })

  it('console_open skills (a read) does not run npx skills; the person opening it does', async () => {
    const claude = liveConsole('read')

    expect(await callTool('console_open', { view: 'skills' }, claude.deps)).toMatch(/^Opened/)
    await flush()
    expect(networkRuns(claude.log.runs)).toEqual([])

    const person = liveConsole('read')

    person.control.setView('skills')
    await flush()
    expect(networkRuns(person.log.runs).length).toBeGreaterThan(0)
  })
})
