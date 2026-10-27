/**
 * Config validation under zod 4.
 *
 * zod 4 removed `ZodError.errors` (use `.issues`). The validator mapped
 * `error.errors`, so every invalid config threw a TypeError out of the
 * validator instead of returning `{ success: false, errors }`.
 */

import { describe, it, expect } from 'vitest';
import {
  validateAgentConfig,
  validateSwarmConfig,
  ConfigValidator,
} from '../src/core/config/validator.js';
import { AgentConfigSchema } from '../src/core/config/schema.js';

describe('config validator under zod 4', () => {
  it('returns structured errors for an invalid agent config', () => {
    const result = validateAgentConfig({ id: '', name: 'x' });
    expect(result.success).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
    const paths = result.errors?.map((e) => e.path) ?? [];
    expect(paths).toContain('id');
    expect(paths).toContain('type');
    for (const e of result.errors ?? []) {
      expect(typeof e.message).toBe('string');
      expect(typeof e.code).toBe('string');
    }
  });

  it('returns structured errors for an invalid swarm topology', () => {
    const result = validateSwarmConfig({ topology: 'not-a-topology' });
    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.path).toBe('topology');
  });

  it('still applies defaults on a valid agent config', () => {
    const result = validateAgentConfig({ id: 'a1', name: 'A', type: 'coder' });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      capabilities: [],
      maxConcurrentTasks: 5,
      priority: 50,
    });
  });

  it('validateAgentOrThrow reports the invalid fields, not a TypeError', () => {
    expect(AgentConfigSchema.safeParse({}).success).toBe(false);
    expect(() => ConfigValidator.validateAgentOrThrow({ id: '' })).toThrow(
      /Invalid agent configuration:\n {2}- id: /,
    );
  });
});
