/**
 * Inputs the console must refuse rather than follow: a `cli` option naming an Object.prototype key, a CLI answer with a trailing `}` line
 * (objectIn, the sibling of #3789), a SKILL.md that is a link (catalog and Skills preview), and a linked agentdb-mod status.json.
 *   npx vitest run plugins/ruflo-console/tests/refused-inputs.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { objectIn, parseSessions, parseWorkflows } from '../hooks/data/automate'
import { probeArgv, versionProbe } from '../hooks/data/cli'
import type { ReadCache, ReaderFs } from '../hooks/data/files'
import { readDoc, type CatalogPlugin } from '../hooks/data/plugin-catalog'
import { readSnapshot } from '../hooks/data/snapshot'
import type { Host } from '../hooks/host'
import { memorySearch } from '../hooks/ops'
import { createRunner } from '../hooks/runner'
import { moreSkillActions } from '../hooks/skills-lab'
import { newState, optionsOf } from '../hooks/state'
import type { Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'

const act: Actions = (() => {
  const handler: ProxyHandler<() => void> = { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined }
  const proxy: unknown = new Proxy(() => undefined, handler)
  return proxy as Actions
})()

const until = async (done: () => boolean) => {
  for (let i = 0; i < 40 && !done(); i++) await new Promise(resolve => setTimeout(resolve, 5))
}

describe('the cli option', () => {
  for (const cli of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    it(`"${cli}" (an Object.prototype key) is not a known prefix: the default stands`, () => {
      expect(optionsOf({ cli } as never).cli).toBe('npx-offline')
    })
  }

  it('with cli "constructor" in the settings, a CLI action still builds its argv and runs', async () => {
    const runs: string[][] = []
    const host = { run: async (argv: readonly string[]) => (runs.push([...argv]), { exitCode: 0, stdout: 'ok', stderr: '' }), invalidate: () => undefined } as unknown as Host
    const state = newState({ cli: 'constructor' } as never)
    const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })

    runner.ask(memorySearch('auth tokens'), '')
    await runner.settled()

    expect({ ran: runs.length, detail: state.outcome?.detail }).toEqual({ ran: 1, detail: 'the ruflo CLI answered:' })
    expect(() => probeArgv(versionProbe, state.options.cli)).not.toThrow()
  })
})

describe('objectIn ends the JSON at its own closing brace', () => {
  const WF = '\u001b[1mResult:\u001b[0m\n{\n  "workflows": [ { "workflowId": "wf-1", "name": "nightly", "status": "running", "stepCount": 3 } ],\n  "total": 1\n}\n'

  it('a trailing log line holding `{}` does not drop a valid answer', () => {
    const out = `${WF}[AgentDB] closed (pending writes: {})\n`

    expect(objectIn(out)).toMatchObject({ total: 1 })
    expect(parseWorkflows(out)).toHaveLength(1)
  })

  it('a trailing line with a stray `}` does not drop a session list', () => {
    expect(parseSessions('Result:\n{\n  "sessions": [ { "sessionId": "s-1", "name": "a" } ],\n  "total": 1\n}\nDone (lexical-degraded}\n')).not.toBeNull()
  })

  it('a brace inside a string is not the close, and an object that never closes is null', () => {
    expect(objectIn('{ "note": "a } inside", "n": 1 }\ntrailing }')).toEqual({ note: 'a } inside', n: 1 })
    expect(objectIn('{ "n": 1\n')).toBeNull()
  })
})

describe('a linked SKILL.md is never read', () => {
  const SKILL = '/m/ruflo/plugins/p/skills/s/SKILL.md'
  const TARGET = 'link target outside the plugin: this text must not be shown\n'
  // The engine follows a link: read returns the target's text, stat reports it as a link.
  const linkFs = (path: string, isLink: boolean): ReaderFs & { reads: string[] } => {
    const reads: string[] = []

    return {
      reads,
      read: async p => (p === path ? (reads.push(p), TARGET) : Promise.reject(new Error('ENOENT'))),
      stat: async p => (p === path ? { mtimeMs: 1, size: TARGET.length, kind: 'file', isLink } : Promise.reject(new Error('ENOENT'))),
      list: async () => [],
    }
  }
  const plugin: CatalogPlugin = { name: 'p', description: '', version: null, dir: '/m/ruflo/plugins/p', skills: ['s'], agents: [], commands: [], hasMcp: false, options: [], isMod: false }

  it('the plugin catalog refuses a link and reads a regular file', async () => {
    const linked = linkFs(SKILL, true)

    expect(await readDoc(linked, plugin, 'skill', 's')).toBeNull()
    expect(linked.reads).toEqual([])
    expect((await readDoc(linkFs(SKILL, false), plugin, 'skill', 's'))?.lines[0]).toContain('link target outside the plugin')
  })

  it('the Skills preview of an installed skill says not-regular for a link, and shows none of its text', async () => {
    const path = '/home/dev/.agents/skills/my-skill/SKILL.md'
    const fs = linkFs(path, true)
    const host = { fs, run: async () => ({ exitCode: 0, stdout: '', stderr: '' }), invalidate: () => undefined } as unknown as Host
    const state = newState({})
    const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })

    moreSkillActions(state, host, runner, () => undefined).previewInstalled({ name: 'my-skill', path: '/home/dev/.agents/skills/my-skill', scope: 'global', agents: [] })
    await until(() => state.skills.preview !== null)

    expect(state.skills.preview?.lines).toEqual([`${path}: not-regular`])
    expect(fs.reads).toEqual([])
  })
})

describe('a linked agentdb-mod status.json', () => {
  const LINK = '/work/.claude-flow/agentdb-mod/status.json'
  const INSTALLED = '/home/dev/.claude/plugins/installed_plugins.json'
  const fs: ReaderFs = {
    read: async path => (path === LINK ? JSON.stringify({ version: 1, recall: true, guard: true, updatedMs: 1 }) : path === INSTALLED ? JSON.stringify({ plugins: { 'ruflo-agentdb@ruflo': [{ version: '0.4.2', scope: 'user' }] } }) : Promise.reject(new Error('ENOENT'))),
    stat: async path => (path === LINK ? { mtimeMs: 1, size: 60, kind: 'file', isLink: true } : path === INSTALLED ? { mtimeMs: 1, size: 90, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
    list: async path => (path === '/work/.claude-flow' ? [{ name: 'agentdb-mod', kind: 'directory' }] : Promise.reject(new Error('ENOENT'))),
  }

  it('is reported as refused (not a regular file), not as "no session yet"', async () => {
    const state = newState({})

    state.snapshot = await readSnapshot(fs, new Map() as ReadCache, '/work', '/home/dev', {}, 0)
    state.view = 'memory'
    const screen = viewText({ state, nowMs: 5_000, columns: 120, act }, 'memory')

    expect(state.snapshot.reads.agentdbMod).toBe('not-regular')
    expect(state.snapshot.agentdbMod).toBeNull()
    expect(state.snapshot.mods.refused).toBe(1)
    expect(screen.split('\n').find(line => line.includes('AgentDB mod'))).toContain('refused (not a regular file)')
    expect(screen).not.toContain('no session yet')
  })
})
