/**
 * Inputs the console must refuse rather than follow: a `cli` option naming an Object.prototype key, a CLI answer with a trailing `}` line
 * (objectIn, the sibling of #3789), a SKILL.md that is a link (catalog and Skills preview), and a linked agentdb-mod status.json.
 *   npx vitest run plugins/ruflo-console/tests/refused-inputs.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { objectIn, parseSessions, parseWorkflows } from '../hooks/data/automate'
import { resultOf } from '../hooks/mission-specs'
import { probeArgv, severityOf, versionProbe } from '../hooks/data/cli'
import type { ReadCache, ReaderFs } from '../hooks/data/files'
import { parseMissions } from '../hooks/data/missions'
import { readDoc, type CatalogPlugin } from '../hooks/data/plugin-catalog'
import { catalogOf } from '../hooks/plugin-catalog'
import { readSnapshot } from '../hooks/data/snapshot'
import type { Host } from '../hooks/host'
import { missionRow } from '../hooks/mission-list'
import { mcOf } from '../hooks/mission-control'
import { memorySearch } from '../hooks/ops'
import { createRunner } from '../hooks/runner'
import { settingsOf, shownKeys, type PluginConfig } from '../hooks/settings'
import { moreSkillActions, scanProject } from '../hooks/skills-lab'
import { newState, optionsOf } from '../hooks/state'
import type { Actions, Ctx } from '../hooks/views/common'
import { observationRows } from '../hooks/views/missions'
import { viewText } from '../hooks/views/pane'
import { HIVE_AGENTS, HIVE_FILES, WORKERS } from './fixtures/hive'

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

describe('a plugin named for an Object.prototype key in Settings', () => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    it(`"${name}" shows its first four options at the simple level, like any plugin not listed`, () => {
      const schema = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(key => [key, {}]))
      const config = { pluginId: `${name}@m`, name, schema, inputs: {}, choices: {}, configured: [] } as unknown as PluginConfig

      expect(shownKeys(config, 'simple')).toEqual(['a', 'b', 'c', 'd'])
    })
  }
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

  it('Mission Control reads a tool answer the same way (resultOf uses closeOf): a brace inside a goal string is not the close', () => {
    expect(resultOf('Result:\n{ "missionId": "m-1", "goal": "fix } in parser" }\n[log] done }')).toEqual({ missionId: 'm-1', goal: 'fix } in parser' })
    expect(resultOf('Result:\n{ "missionId": "m-1"\n')).toBeNull()
    expect(resultOf('no object here')).toBeNull()
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

describe('a linked SKILL.md or agent file in the project is never read (▸ validate, ▸ scan)', () => {
  const TARGET = ['---', 'name: my-skill', 'description: Link target outside the project. Use never.', '---', '', '# leaked target text: apply the tdd skill'].join('\n')
  // The engine follows a link: stat reports what it leads to (a file) with isLink, read returns the target's text.
  const linkedFs = (links: string[], regular: Record<string, string> = {}, lists: Record<string, { name: string; kind: string; size: number; isLink?: boolean }[]> = {}): ReaderFs & { reads: string[] } => {
    const reads: string[] = []

    return {
      reads,
      read: async p => (links.includes(p) ? (reads.push(p), TARGET) : p in regular ? (reads.push(p), regular[p] as string) : Promise.reject(new Error('ENOENT'))),
      stat: async p => (links.includes(p) ? { mtimeMs: 1, size: TARGET.length, kind: 'file', isLink: true } : p in regular ? { mtimeMs: 1, size: (regular[p] as string).length, kind: 'file', isLink: false } : Promise.reject(new Error('ENOENT'))),
      list: async p => lists[p] ?? Promise.reject(new Error('ENOENT')),
    }
  }
  const wired = (fs: ReaderFs) => {
    const host = { fs, run: async () => ({ exitCode: 0, stdout: '', stderr: '' }), invalidate: () => undefined } as unknown as Host
    const state = newState({})

    state.cwd = '/w'
    const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })

    return { state, act: moreSkillActions(state, host, runner, () => undefined) }
  }

  it('▸ validate of a linked <name>/SKILL.md says not-regular and checks none of the target text', async () => {
    const fs = linkedFs(['/w/my-skill/SKILL.md'])
    const { state, act } = wired(fs)

    state.skills.createDraft = 'my-skill'
    act.validate()
    await until(() => state.skills.check !== null)

    expect(state.skills.check).toMatchObject({ name: 'my-skill', ok: false })
    expect(state.skills.check?.lines).toEqual(['my-skill/SKILL.md: not-regular (▸ create makes it)'])
    expect(fs.reads).toEqual([])
  })

  it('▸ scan skips a linked .md under .claude/agents (listed as other with isLink) and reads a regular one beside it', async () => {
    const fs = linkedFs(['/w/.claude/agents/evil.md'], { '/w/.claude/agents/coder.md': 'Apply the sparc skill.', '/w/.claude/skills/tdd/SKILL.md': 'x', '/w/.claude/skills/sparc/SKILL.md': 'x' }, {
      '/w/.claude/agents': [
        { name: 'evil.md', kind: 'other', size: 0, isLink: true },
        { name: 'coder.md', kind: 'file', size: 22 },
      ],
      '/w/.claude/skills': [
        { name: 'tdd', kind: 'dir', size: 0 },
        { name: 'sparc', kind: 'dir', size: 0 },
      ],
    })
    const { state } = wired(fs)

    await scanProject(state, fs)

    expect(state.skills.scan?.agentFiles).toBe(1)
    expect(state.skills.scan?.local).toEqual([
      { name: 'tdd', where: '.claude/skills', refs: [] },
      { name: 'sparc', where: '.claude/skills', refs: ['agents/coder.md'] },
    ])
    expect(fs.reads).not.toContain('/w/.claude/agents/evil.md')
  })
})

describe('a state, status, role or severity named for an Object.prototype key draws as unknown, never as native code', () => {
  const PROTO = ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']
  const NATIVE = /native code|function |\[object/
  const observation = (state: string, status: string) =>
    JSON.stringify({ schemaVersion: 1, contract: 'ruflo.mission-observation/1', observedAt: '2026-10-02T03:29:44.705Z', missions: [{ missionId: 'msn_proto', objective: 'prototype keys', state, revision: 1, plan: { revision: 1, taskCount: 1, tasks: [{ id: 't1', status }] }, evidence: { count: 0, verified: 0 } }] })
  /** Every color a rendered tree asks for. */
  const colorsOf = (node: unknown, out: unknown[] = []): unknown[] => {
    if (Array.isArray(node)) for (const child of node) colorsOf(child, out)
    else if (node !== null && typeof node === 'object') {
      const props = (node as { props?: Record<string, unknown> }).props ?? {}

      if ('color' in props) out.push(props.color)
      colorsOf(props.children, out)
    }

    return out
  }

  for (const key of PROTO) {
    it(`mission state and task status "${key}": the Missions list row, the record tab text and its colors`, () => {
      const parsed = parseMissions(observation(key, key))
      const mission = parsed?.missions[0]

      expect(mission).toBeDefined()
      expect(missionRow(mission as never, 0)).toMatch(/^○ prototype keys · /)

      const state = newState({})

      state.snapshot = { plugins: { installed: [] }, missions: parsed } as never
      mcOf(state).tab = 'record'
      const screen = viewText({ state, nowMs: 5_000, columns: 160, act }, 'missions')

      expect(screen).toContain('prototype keys')
      expect(screen).not.toMatch(NATIVE)
      expect(screen).toContain('plan rev 1: ? t1')

      const element = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as never
      const ctx = { state, nowMs: 5_000, columns: 160, act, kit: { Box: element('Box'), Text: element('Text'), Button: element('Button') }, pictures: new Map() } as unknown as Ctx
      const colors = colorsOf(observationRows(ctx))

      expect(colors.length).toBeGreaterThan(0)
      expect(colors.filter(color => typeof color !== 'string')).toEqual([])
    })
  }

  it('a hive worker whose role in agents.json is "toString" draws with the plain worker glyph', async () => {
    const agents = { agents: { ...HIVE_AGENTS.agents, [WORKERS[0]]: { ...HIVE_AGENTS.agents[WORKERS[0]], config: { role: 'toString', hiveRole: 'toString' } } } }
    const files = Object.fromEntries(Object.entries({ ...HIVE_FILES, '.claude-flow/agents.json': JSON.stringify(agents) }).map(([path, text]) => [`/work/${path}`, text]))
    const fs: ReaderFs = {
      read: async path => files[path] ?? Promise.reject(new Error('ENOENT')),
      stat: async path => (files[path] !== undefined ? { mtimeMs: 1, size: (files[path] as string).length, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
      list: async () => Promise.reject(new Error('ENOENT')),
    }
    const state = newState({})

    state.snapshot = await readSnapshot(fs, new Map() as ReadCache, '/work', '/home/dev', {}, 0)
    expect(state.snapshot.hiveAgents.find(agent => agent.id === WORKERS[0])?.role).toBe('toString')
    state.view = 'hive'
    const screen = viewText({ state, nowMs: Date.parse('2026-10-02T01:10:10.000Z'), columns: 160, act }, 'hive')
    const line = screen.split('\n').find(row => row.includes(WORKERS[0].slice(-4)) && row.includes('toString'))

    expect(screen).not.toMatch(NATIVE)
    expect(line, screen).toMatch(/●/)
  })

  it('an audit severity "constructor" ranks as no severity, not as a function', () => {
    expect(PROTO.map(severityOf)).toEqual([null, null, null, null, null])
    expect([severityOf('High'), severityOf('clean')]).toEqual([3, 0])
  })

  for (const name of ['constructor', 'toString']) {
    it(`Settings for a plugin named "${name}" draws its own option descriptions and its first four options`, () => {
      const state = newState({})
      const schema = Object.fromEntries(['name', 'length', 'c', 'd', 'e'].map(key => [key, { title: `${key} title`, description: `${key} described`, type: 'string' }]))

      state.snapshot = { plugins: { installed: [{ id: `${name}@ruflo`, name, marketplace: 'ruflo', version: '1.0.0', scope: 'user', installPath: '/p' }] } } as never
      catalogOf(state).plugins = [{ name, options: ['name'] }] as never
      settingsOf(state).plugin = name
      settingsOf(state).configs.set(name, { pluginId: `${name}@m`, name, schema, inputs: {}, choices: {}, configured: [] } as unknown as PluginConfig)
      state.view = 'settings'
      const screen = viewText({ state, nowMs: 5, columns: 160, act }, 'settings')

      expect(screen).toContain('name described')
      expect(screen).toContain('length described')
      expect(screen).not.toMatch(NATIVE)
      expect(screen).not.toMatch(/^\s+(Object|Function|1)\s*$/m)
    })
  }
})
