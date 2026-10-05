/**
 * Config values keep the precision the console's own form accepts (data/automate.ts configValueOf: six decimals): the CLI echoes
 * them exactly (v3 mcp-tools/config-tools.ts config_get, config_set, config_list), so a bound that rounds must not round them away.
 */
import { describe, expect, it } from 'vitest'

import { configGet, configSet } from '../hooks/automate'
import { configValueOf, parseConfig, shownValue } from '../hooks/data/automate'

describe('config values the CLI echoes exactly', () => {
  it('the form accepts 0.0005', () => expect(configValueOf('0.0005')).toBe(0.0005))

  it('config_set echoes the new and previous value as stored', () => {
    const out = JSON.stringify({ success: true, key: 'neural.learningRate', value: 0.0005, previousValue: 0.0001, scope: 'default', path: '/p/.claude-flow/config.json' })

    expect(configSet('neural.learningRate 0.0005')?.read?.(out, '', true)?.[0]).toBe('neural.learningRate = 0.0005 (was 0.0001)')
  })

  it('config_get shows the stored value', () => {
    const out = JSON.stringify({ key: 'neural.learningRate', value: 0.0001, scope: 'default', exists: true, source: 'stored' })

    expect(configGet('neural.learningRate')?.read?.(out, '', true)?.[0]).toBe('neural.learningRate = 0.0001')
  })

  it('config_list shows each value as stored', () => {
    expect(parseConfig(JSON.stringify({ configs: [{ key: 'neural.learningRate', value: 0.0001, source: 'stored' }] }))?.[0]?.shown).toBe('0.0001')
    expect(shownValue('x', 0.0005).shown).toBe('0.0005')
  })
})

describe('a value the CLI writes below a millionth', () => {
  it('reads as smaller than a millionth, never as 0 (embeddings_init stores hyperbolic.epsilon 1e-15)', async () => {
    const { shownOf, boundedJson, measureOf } = await import('../hooks/data/bounds')

    expect(shownOf(1e-15)).toBe('<0.000001')
    expect(shownOf(-1e-15)).toBe('>-0.000001')
    expect(shownOf(0)).toBe('0')
    expect(shownOf(12.3456789)).toBe('12.345679')
    expect(shownOf(0.0001)).toBe('0.0001')
    expect(measureOf(0.0004)).toBe('<0.001')
    expect(boundedJson({ hyperbolic: { epsilon: 1e-15, maxNorm: 1 - 1e-5 } })).toBe('{"hyperbolic":{"epsilon":"<0.000001","maxNorm":0.99999}}')
  })
})
