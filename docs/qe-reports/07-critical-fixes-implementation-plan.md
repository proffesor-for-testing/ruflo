# Critical Fixes Implementation Plan

**Date**: 2026-04-08
**Version**: Ruflo v3.5.72
**Branch**: `qe-working-branch` (cherry-pick to `main` via PR)
**Scope**: 3 Critical Security, 5 High Security, 3 Critical Performance issues

---

## Table of Contents

1. [Milestone 1: Critical Security Fixes](#milestone-1-critical-security-fixes)
2. [Milestone 2: High Security Fixes](#milestone-2-high-security-fixes)
3. [Milestone 3: Critical Performance Fixes](#milestone-3-critical-performance-fixes)
4. [Dependency Graph](#dependency-graph)
5. [Rollout Plan](#rollout-plan)
6. [Complexity Summary](#complexity-summary)

---

## Milestone 1: Critical Security Fixes

### CRIT-01: SQL Injection in Embeddings Search

**File**: `v3/@claude-flow/cli/src/commands/embeddings.ts`
**Lines**: 172-179 (embedding search), 212-218 (keyword search)
**Severity**: CRITICAL -- attacker-controlled `namespace` and `query` are interpolated directly into SQL strings passed to `db.exec()`.

#### Current Vulnerable Code

**Location 1 -- Embedding vector search (line 172-179):**

```typescript
const entries = db.exec(`
  SELECT id, key, namespace, content, embedding, embedding_dimensions
  FROM memory_entries
  WHERE status = 'active'
    AND embedding IS NOT NULL
    ${namespace !== 'all' ? `AND namespace = '${namespace}'` : ''}
  LIMIT 1000
`);
```

`namespace` is user-supplied CLI input. Single quotes in `namespace` break out of the string literal. No escaping whatsoever.

**Location 2 -- Keyword search fallback (lines 212-218):**

```typescript
const keywordEntries = db.exec(`
  SELECT id, key, namespace, content
  FROM memory_entries
  WHERE status = 'active'
    AND (content LIKE '%${query.replace(/'/g, "''")}%' OR key LIKE '%${query.replace(/'/g, "''")}%')
    ${namespace !== 'all' ? `AND namespace = '${namespace}'` : ''}
  LIMIT ${limit - results.length}
`);
```

`query` uses single-quote doubling which is insufficient (does not protect against backslash-based escapes, Unicode tricks, or multi-byte attacks). `namespace` is still completely unescaped. `limit` is a computed number from `limit - results.length` which is safe, but should be validated.

#### Proposed Fix

The `sql.js` library's `db.exec()` does not natively support parameterized queries, but `db.run()` and prepared statements via `db.prepare()` do. Refactor both queries to use `db.prepare()` with bound parameters.

**Fix for Location 1:**

```typescript
// BEFORE (vulnerable):
const entries = db.exec(`
  SELECT id, key, namespace, content, embedding, embedding_dimensions
  FROM memory_entries
  WHERE status = 'active'
    AND embedding IS NOT NULL
    ${namespace !== 'all' ? `AND namespace = '${namespace}'` : ''}
  LIMIT 1000
`);

// AFTER (parameterized):
const sql = namespace !== 'all'
  ? `SELECT id, key, namespace, content, embedding, embedding_dimensions
     FROM memory_entries
     WHERE status = 'active' AND embedding IS NOT NULL AND namespace = ?
     LIMIT 1000`
  : `SELECT id, key, namespace, content, embedding, embedding_dimensions
     FROM memory_entries
     WHERE status = 'active' AND embedding IS NOT NULL
     LIMIT 1000`;

const stmt = db.prepare(sql);
if (namespace !== 'all') {
  stmt.bind([namespace]);
}

const entryRows: any[][] = [];
while (stmt.step()) {
  entryRows.push(stmt.get());
}
stmt.free();

// Then iterate entryRows instead of entries[0]?.values
```

**Fix for Location 2:**

```typescript
// BEFORE (vulnerable):
const keywordEntries = db.exec(`
  SELECT id, key, namespace, content
  FROM memory_entries
  WHERE status = 'active'
    AND (content LIKE '%${query.replace(/'/g, "''")}%' OR key LIKE '%${query.replace(/'/g, "''")}%')
    ${namespace !== 'all' ? `AND namespace = '${namespace}'` : ''}
  LIMIT ${limit - results.length}
`);

// AFTER (parameterized):
const keywordSql = namespace !== 'all'
  ? `SELECT id, key, namespace, content
     FROM memory_entries
     WHERE status = 'active'
       AND (content LIKE ? OR key LIKE ?)
       AND namespace = ?
     LIMIT ?`
  : `SELECT id, key, namespace, content
     FROM memory_entries
     WHERE status = 'active'
       AND (content LIKE ? OR key LIKE ?)
     LIMIT ?`;

const likePattern = `%${query}%`;
const remainingLimit = Math.max(0, limit - results.length);
const keywordStmt = db.prepare(keywordSql);
if (namespace !== 'all') {
  keywordStmt.bind([likePattern, likePattern, namespace, remainingLimit]);
} else {
  keywordStmt.bind([likePattern, likePattern, remainingLimit]);
}

const keywordRows: any[][] = [];
while (keywordStmt.step()) {
  keywordRows.push(keywordStmt.get());
}
keywordStmt.free();
```

#### Verification

1. Unit test: pass `namespace = "'; DROP TABLE memory_entries; --"` and verify no SQL execution.
2. Unit test: pass `query = "test' OR '1'='1"` and verify it is treated as a literal string.
3. Functional test: existing embedding search with normal namespace/query still returns correct results.
4. Manual: `npx @claude-flow/cli@latest embeddings search --query "hello" --namespace "default"` works as before.

#### Risk Assessment

- **Low risk**: The refactored queries produce identical results for valid inputs. The sql.js `prepare()`/`bind()` API is well-documented. The only behavioral change is that malicious input now fails safely instead of executing.

---

### CRIT-02: Command Injection via execSync (10+ files)

**Primary file**: `v3/@claude-flow/cli/src/commands/ruvector/import.ts:341-343`
**Additional files**: 9 other CLI command files with direct `child_process` imports

#### Full Inventory of Affected Locations

| # | File | Line(s) | Pattern | Risk Level |
|---|------|---------|---------|------------|
| 1 | `ruvector/import.ts` | 341-343 | `execSync(\`docker exec -i ${containerName} ...\`)` | **CRITICAL** -- `containerName` is user input |
| 2 | `hive-mind.ts` | 13, 237 | `execSync('which claude', ...)` | LOW -- hardcoded command |
| 3 | `analyze.ts` | 24, 1507 | `execSync('npm audit --json 2>/dev/null', ...)` | LOW -- hardcoded command |
| 4 | `security.ts` | 45-55, 228 | `execSync('npm audit --json', ...)`, `execSync('npm audit fix', ...)` | LOW -- hardcoded, but `target` flows into `cwd` |
| 5 | `security.ts` | 356-357 | `require('child_process'); execSync('git ls-files --cached', ...)` | LOW -- hardcoded |
| 6 | `init.ts` | 66-67 | `execSync('npm root -g', ...)` | LOW -- hardcoded |
| 7 | `init.ts` | 335-399 | `execSync('npx @claude-flow/cli@latest ...', ...)` | MEDIUM -- hardcoded commands, but uses shell features (2>/dev/null, &) |
| 8 | `init.ts` | 642-644 | `execSync(\`npx ... --model ${embeddingModel} ...\`)` | **HIGH** -- `embeddingModel` is user flag input |
| 9 | `doctor.ts` | 13, 396 | `execSync('npm install -g @anthropic-ai/claude-code', ...)` | LOW -- hardcoded |
| 10 | `hooks.ts` | 3957, 4054, 4145-4146 | `execSync(psCmd, ...)`, `execSync(nameCmd, ...)` | LOW -- platform-conditional, hardcoded |
| 11 | `daemon.ts` | 9 | `import { spawn, execFile } from 'child_process'` | LOW -- uses `spawn`/`execFile` (safer), not `execSync` with shell |

**SafeExecutor exists at**: `v3/@claude-flow/security/src/safe-executor.ts`

The SafeExecutor provides:
- `execute(command, args)` -- uses `execFile` (no shell), with allowlist + argument validation
- `executeStreaming(command, args)` -- uses `spawn` (no shell)
- `sanitizeArgument(arg)` -- strips shell metacharacters
- `createDevelopmentExecutor()` -- factory with `git, npm, node, tsc, vitest, eslint, prettier`

#### Proposed Fix Strategy

**Tier 1 -- Critical user-input injection (must fix immediately):**

**ruvector/import.ts (line 343):**

```typescript
// BEFORE (vulnerable):
const { execSync } = await import('child_process');
const result = execSync(`docker exec -i ${containerName} psql -U claude -d claude_flow < ${tempFile}`, {
  encoding: 'utf-8',
  timeout: 60000,
});

// AFTER (safe):
import { SafeExecutor } from '../../../../security/src/safe-executor.js';

const executor = new SafeExecutor({
  allowedCommands: ['docker'],
  timeout: 60000,
});
const result = await executor.execute('docker', [
  'exec', '-i', containerName,
  'psql', '-U', 'claude', '-d', 'claude_flow',
  '-f', '/dev/stdin',
]);
// Note: The original uses shell redirection (<). With execFile, we need to
// pipe stdin instead. Alternative approach using Node's child_process directly:

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

// Validate containerName: alphanumeric, hyphens, underscores only
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) {
  throw new Error(`Invalid container name: ${containerName}`);
}

const sqlContent = readFileSync(tempFile, 'utf-8');
const result = execFileSync('docker', [
  'exec', '-i', containerName,
  'psql', '-U', 'claude', '-d', 'claude_flow',
], {
  encoding: 'utf-8',
  timeout: 60000,
  input: sqlContent, // pipe SQL via stdin instead of shell redirection
});
```

**init.ts (line 399, 644) -- `embeddingModel` user input:**

```typescript
// BEFORE (vulnerable):
execSync(`npx @claude-flow/cli@latest embeddings init --model ${embeddingModel} --no-download --force 2>/dev/null`, {
  stdio: 'pipe',
  cwd: ctx.cwd,
  timeout: 30000
});

// AFTER (safe):
import { execFileSync } from 'child_process';

// Validate embeddingModel: must match pattern org/model-name
if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(embeddingModel)) {
  throw new Error(`Invalid embedding model name: ${embeddingModel}`);
}

try {
  execFileSync('npx', [
    '@claude-flow/cli@latest', 'embeddings', 'init',
    '--model', embeddingModel,
    '--no-download', '--force',
  ], {
    stdio: 'pipe',
    cwd: ctx.cwd,
    timeout: 30000,
  });
} catch {
  // stderr captured by stdio: 'pipe', same behavior as 2>/dev/null
}
```

**Tier 2 -- Hardcoded commands that use shell features (medium priority):**

For hardcoded commands (npm audit, git config, which, ps), these are not exploitable since no user input enters the command string. However, they violate defense-in-depth and bypass SafeExecutor. The fix is to replace `execSync(cmdString)` with `execFileSync(binary, [...args])` to eliminate shell interpretation:

```typescript
// BEFORE:
execSync('npm audit --json 2>/dev/null', { encoding: 'utf-8', ... });

// AFTER:
try {
  execFileSync('npm', ['audit', '--json'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
} catch (e: any) {
  // npm audit exits non-zero when vulns found; stdout still has JSON
  const auditResult = e.stdout || '{}';
}
```

```typescript
// BEFORE:
execSync('which claude', { stdio: 'ignore' });

// AFTER:
execFileSync('which', ['claude'], { stdio: 'ignore' });
```

```typescript
// BEFORE:
execSync('git config user.name 2>/dev/null || echo "user"', ...);

// AFTER:
try {
  name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf-8' }).trim();
} catch {
  name = 'user';
}
```

**Tier 3 -- init.ts internal CLI invocations (lower priority):**

Lines 341, 356, 371 invoke `npx @claude-flow/cli@latest ...` with shell features (`2>/dev/null`, `&`). These are hardcoded strings with no user input in the command, but should still use `execFileSync`/`spawn` for consistency.

#### Verification

1. For ruvector import: test with `containerName = "test; rm -rf /"` and verify it is rejected.
2. For init embeddings: test with `embeddingModel = "model; whoami"` and verify rejection.
3. For hardcoded commands: verify `npx @claude-flow/cli@latest doctor` still runs all checks.
4. Grep to confirm zero remaining `execSync(\`...${` patterns in CLI commands.

#### Risk Assessment

- **Medium risk for ruvector/import.ts**: The stdin piping approach changes how SQL reaches psql. Test with actual Docker container.
- **Low risk for init.ts**: execFileSync is a drop-in replacement when shell features are removed.
- **Low risk for hardcoded commands**: The error handling must replicate the shell fallback behavior (e.g., `|| echo "user"`).

---

### CRIT-03: Arbitrary JS Execution via Browser Eval

**File**: `v3/@claude-flow/browser/src/mcp-tools/browser-tools.ts:624-641`
**Severity**: CRITICAL -- the `browser/eval` MCP tool executes arbitrary JavaScript with zero validation.

#### Current Vulnerable Code

```typescript
const evalTools: MCPTool[] = [
  {
    name: 'browser/eval',
    description: 'Execute JavaScript in the page context',
    category: 'browser-eval',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        script: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['script'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.eval({ script: input.script as string });
    },
  },
];
```

Problems:
1. No input validation on `script` (arbitrary JS)
2. No Zod schema validation
3. No length limit
4. No sandboxing or execution timeout
5. No audit logging

#### Proposed Fix

Add input validation, script length limit, dangerous pattern detection, and audit logging. Do NOT remove the tool since browser automation requires eval capability, but constrain it.

```typescript
// Dangerous patterns that should never appear in eval scripts
const DANGEROUS_EVAL_PATTERNS = [
  /\bprocess\b/,           // Node.js process access
  /\brequire\b/,           // CommonJS require
  /\b__dirname\b/,         // Node path leaking
  /\b__filename\b/,        // Node path leaking
  /\bchild_process\b/,     // Command execution
  /\bglobal\b\s*\./,       // Global object mutation
  /\bFunction\s*\(/,       // Function constructor (eval-equivalent)
  /\bimport\s*\(/,         // Dynamic import
];

const MAX_EVAL_SCRIPT_LENGTH = 10_000; // 10KB limit

const evalTools: MCPTool[] = [
  {
    name: 'browser/eval',
    description: 'Execute JavaScript in the page context (validated, length-limited)',
    category: 'browser-eval',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        script: {
          type: 'string',
          description: 'JavaScript code to execute (max 10KB)',
          maxLength: MAX_EVAL_SCRIPT_LENGTH,
        },
      },
      required: ['script'],
    },
    handler: async (input) => {
      const script = input.script as string;

      // Validate script length
      if (!script || script.length === 0) {
        throw new Error('browser/eval: script must not be empty');
      }
      if (script.length > MAX_EVAL_SCRIPT_LENGTH) {
        throw new Error(`browser/eval: script exceeds maximum length of ${MAX_EVAL_SCRIPT_LENGTH} characters`);
      }

      // Check for dangerous patterns
      for (const pattern of DANGEROUS_EVAL_PATTERNS) {
        if (pattern.test(script)) {
          throw new Error(`browser/eval: script contains disallowed pattern: ${pattern.source}`);
        }
      }

      // Audit log
      console.info(`[browser/eval] Executing script (${script.length} chars) in session ${input.session || 'default'}`);

      const adapter = getAdapter(input.session as string);
      return adapter.eval({ script });
    },
  },
];
```

#### Verification

1. Test: `script = "process.exit(1)"` should be rejected with "disallowed pattern" error.
2. Test: `script = "require('child_process').execSync('whoami')"` should be rejected.
3. Test: `script = "document.title"` should succeed (normal browser operation).
4. Test: empty script should be rejected.
5. Test: script > 10KB should be rejected.

#### Risk Assessment

- **Low risk**: Existing legitimate browser automation scripts use DOM APIs (`document.*`, `window.*`) which are not blocked. The pattern blocklist targets Node.js-specific globals that should never appear in browser page context. False positives are unlikely in real usage.
- **Caveat**: This is defense-in-depth, not a sandbox. The browser page context is inherently powerful. Consider adding a configuration flag to disable `browser/eval` entirely in production environments.

---

## Milestone 2: High Security Fixes

### HIGH-01: SafeExecutor Systematically Bypassed

**Scope**: 10+ CLI command files import `child_process` directly

This is addressed as part of CRIT-02 (Tier 2 and Tier 3 fixes). The remaining architectural enforcement is:

#### Proposed Fix: ESLint Rule

Create an ESLint rule to prevent direct `child_process` imports in CLI command files.

**File**: `v3/@claude-flow/cli/.eslintrc.json` (or equivalent config)

```jsonc
{
  "rules": {
    "no-restricted-imports": ["error", {
      "paths": [
        {
          "name": "child_process",
          "message": "Use SafeExecutor from @claude-flow/security or execFileSync (no shell) instead. See ADR-078."
        }
      ]
    }]
  },
  "overrides": [
    {
      // Allow in SafeExecutor itself and daemon (uses spawn/execFile correctly)
      "files": [
        "**/security/src/safe-executor.ts",
        "**/commands/daemon.ts"
      ],
      "rules": {
        "no-restricted-imports": "off"
      }
    }
  ]
}
```

For files that need shell-like behavior (e.g., `init.ts` calling `npx`), add a `createCliExecutor()` factory to SafeExecutor:

```typescript
// Add to safe-executor.ts
export function createCliExecutor(): SafeExecutor {
  return new SafeExecutor({
    allowedCommands: [
      'git', 'npm', 'npx', 'node', 'docker',
      'which', 'tsc', 'vitest',
    ],
    timeout: 60000,
  });
}
```

#### Verification

1. Run ESLint across `v3/@claude-flow/cli/src/commands/` and verify all direct `child_process` imports are flagged (except exempted files).
2. Fix each flagged import as per CRIT-02 plan.

#### Risk Assessment

- **Low risk**: ESLint rule is advisory and does not change runtime behavior. The actual fixes are in CRIT-02.

---

### HIGH-02: --dangerously-skip-permissions Defaults ON

**File**: `v3/@claude-flow/cli/src/commands/hive-mind.ts:262`

#### Current Vulnerable Code

```typescript
// Line 262
const skipPermissions = flags['dangerously-skip-permissions'] !== false && !flags['no-auto-permissions'];
```

This condition evaluates to `true` when the flag is `undefined` (not provided), meaning the dangerous flag defaults to ON.

#### Proposed Fix

```typescript
// BEFORE:
const skipPermissions = flags['dangerously-skip-permissions'] !== false && !flags['no-auto-permissions'];

// AFTER:
const skipPermissions = flags['dangerously-skip-permissions'] === true && !flags['no-auto-permissions'];
```

The flag must now be explicitly set to `true` (via `--dangerously-skip-permissions` on the CLI) to activate. When omitted, `flags['dangerously-skip-permissions']` is `undefined`, which is not `=== true`, so it defaults to OFF.

#### Verification

1. `npx @claude-flow/cli@latest hive-mind start` -- should NOT include `--dangerously-skip-permissions` in claude args.
2. `npx @claude-flow/cli@latest hive-mind start --dangerously-skip-permissions` -- should include it.
3. Check the warning message only appears when the flag is explicitly passed.

#### Risk Assessment

- **Low risk**: This is a one-line change. Users who relied on the implicit default will need to add the flag explicitly, which is the intended behavior (opt-in to danger).

---

### HIGH-03: Prototype Pollution via Raw JSON.parse

**Files**:
- `v3/@claude-flow/memory/src/agentdb-backend.ts:924-932`
- `v3/@claude-flow/memory/src/sqlite-backend.ts:677-685`
- `v3/@claude-flow/memory/src/sqljs-backend.ts:720-728`

All three memory backends use raw `JSON.parse()` to deserialize `tags`, `metadata`, and `references` from database rows, despite `safeJsonParse()` being available in `@claude-flow/plugins/src/security/index.ts`.

#### Current Vulnerable Code (agentdb-backend.ts:924-932)

```typescript
tags: JSON.parse(row.tags || '[]'),
metadata: JSON.parse(row.metadata || '{}'),
// ...
references: JSON.parse(row.references || '[]'),
```

Identical pattern in sqlite-backend.ts:677-685 and sqljs-backend.ts:720-728.

#### Proposed Fix

Import `safeJsonParse` from the plugins security module and replace all `JSON.parse` calls in the three row-to-entry conversion functions.

**For agentdb-backend.ts:**

```typescript
// Add import at top of file:
import { safeJsonParse } from '../../plugins/src/security/index.js';

// BEFORE (line 924-932):
tags: JSON.parse(row.tags || '[]'),
metadata: JSON.parse(row.metadata || '{}'),
references: JSON.parse(row.references || '[]'),

// AFTER:
tags: safeJsonParse<string[]>(row.tags || '[]'),
metadata: safeJsonParse<Record<string, unknown>>(row.metadata || '{}'),
references: safeJsonParse<string[]>(row.references || '[]'),
```

**For sqlite-backend.ts:**

```typescript
// Add import at top of file:
import { safeJsonParse } from '../../plugins/src/security/index.js';

// BEFORE (line 677-685):
tags: JSON.parse(row.tags),
metadata: JSON.parse(row.metadata),
references: JSON.parse(row.references),

// AFTER:
tags: safeJsonParse<string[]>(row.tags || '[]'),
metadata: safeJsonParse<Record<string, unknown>>(row.metadata || '{}'),
references: safeJsonParse<string[]>(row.references || '[]'),
```

**For sqljs-backend.ts:**

```typescript
// Add import at top of file:
import { safeJsonParse } from '../../plugins/src/security/index.js';

// BEFORE (line 720-728):
tags: JSON.parse(row.tags as string),
metadata: JSON.parse(row.metadata as string),
references: JSON.parse(row.references as string),

// AFTER:
tags: safeJsonParse<string[]>((row.tags as string) || '[]'),
metadata: safeJsonParse<Record<string, unknown>>((row.metadata as string) || '{}'),
references: safeJsonParse<string[]>((row.references as string) || '[]'),
```

#### Verification

1. Unit test: store an entry with `metadata = '{"__proto__": {"isAdmin": true}}'`, retrieve it, and verify the resulting object does NOT have `isAdmin` on its prototype chain.
2. Unit test: store/retrieve with normal JSON to confirm no regression.
3. Grep: confirm no remaining `JSON.parse` in the three `rowToEntry` / row conversion functions.

#### Risk Assessment

- **Very low risk**: `safeJsonParse` is a superset of `JSON.parse` that only strips `__proto__`, `constructor`, and `prototype` keys. Normal data is unaffected. The function is already well-tested (`v3/@claude-flow/plugins/__tests__/security.test.ts:159-173`).

---

### HIGH-04: Plugin System No Sandboxing

**Assessment**: Full plugin sandboxing (V8 isolates, WASM sandbox) is out of scope for this fix cycle. This is a next-quarter initiative.

#### Proposed Fix (Minimal)

1. Add a startup warning when plugins are loaded:

```typescript
console.warn('[SECURITY] Plugin loaded without sandboxing: ' + pluginId + '. Plugins run with full process access.');
```

2. Add capability check stubs in the plugin loader that log when plugins use sensitive APIs:

```typescript
// In plugin loader, wrap plugin context:
const pluginContext = {
  ...baseContext,
  // Audit-log sensitive operations
  fs: new Proxy(fs, {
    get(target, prop) {
      console.info(`[PLUGIN:${pluginId}] fs.${String(prop)} accessed`);
      return target[prop as keyof typeof fs];
    }
  }),
};
```

3. Document the risk in the plugin README with a "Security Model" section.

#### Verification

1. Load a plugin and verify the security warning appears in logs.
2. Verify no existing plugins break.

#### Risk Assessment

- **Very low risk**: Logging-only changes. No behavioral changes to plugin execution.

---

### HIGH-05: HNSW 31-bit Hash Collision

**File**: `v3/@claude-flow/memory/src/agentdb-backend.ts:940-948`

#### Current Vulnerable Code

```typescript
private stringIdToNumeric(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}
```

This produces a 31-bit hash (since `Math.abs` on a 32-bit signed integer gives 0 to 2^31-1). With birthday paradox, collisions are expected at ~46K entries. The reverse lookup map at line 954 (`numericToStringIdMap`) means collisions cause silent data loss -- a newer entry with the same numeric hash overwrites the older one in the reverse map.

#### Proposed Fix

Use two independent 32-bit hashes combined into a single JavaScript safe integer (up to 2^53). This gives ~53 bits of hash space, pushing birthday-paradox collisions out to ~94 million entries.

```typescript
// BEFORE:
private stringIdToNumeric(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// AFTER:
private stringIdToNumeric(id: string): number {
  // Hash A: djb2
  let hashA = 5381;
  for (let i = 0; i < id.length; i++) {
    hashA = ((hashA << 5) + hashA + id.charCodeAt(i)) | 0;
  }

  // Hash B: sdbm (independent seed/algorithm)
  let hashB = 0;
  for (let i = 0; i < id.length; i++) {
    hashB = id.charCodeAt(i) + ((hashB << 6) + (hashB << 16) - hashB) | 0;
  }

  // Combine into a 53-bit safe integer:
  // Use 26 bits from hashA and 27 bits from hashB
  const upper = (Math.abs(hashA) & 0x3FFFFFF); // 26 bits
  const lower = (Math.abs(hashB) & 0x7FFFFFF); // 27 bits
  return upper * 0x8000000 + lower; // upper << 27 | lower, but safe for JS
}
```

Additionally, add a collision detection check in the reverse map registration:

```typescript
// Where entries are registered in the forward/reverse maps:
const numericId = this.stringIdToNumeric(entry.id);
const existing = this.numericToStringIdMap.get(numericId);
if (existing && existing !== entry.id) {
  console.warn(`[HNSW] Hash collision detected: "${entry.id}" collides with "${existing}" (numeric: ${numericId})`);
  // Use a fallback: increment until no collision
  let fallbackId = numericId + 1;
  while (this.numericToStringIdMap.has(fallbackId)) {
    fallbackId++;
  }
  this.numericToStringIdMap.set(fallbackId, entry.id);
  this.stringToNumericIdMap.set(entry.id, fallbackId);
  return;
}
this.numericToStringIdMap.set(numericId, entry.id);
this.stringToNumericIdMap.set(entry.id, numericId);
```

#### Verification

1. Unit test: hash 100K random UUIDs and verify zero collisions.
2. Unit test: verify the hash function is deterministic (same input always produces same output).
3. Unit test: verify the collision fallback works when forced.
4. Integration test: store and retrieve entries by ID after re-hashing.

#### Risk Assessment

- **Medium risk**: Changing the hash function invalidates any persisted numeric IDs from previous HNSW index builds. The HNSW index would need to be rebuilt. The `numericToStringIdMap` is rebuilt at runtime from the entry store, so the change is safe for fresh starts. Existing persisted HNSW graphs will need re-indexing. Add a migration step or log a warning on startup.

---

## Milestone 3: Critical Performance Fixes

### PERF-01: Unbounded seenMessages in Gossip

**File**: `v3/@claude-flow/swarm/src/consensus/gossip.ts`
**Lines**: 32 (definition), 70 (node initialization), 93 (addNode), 285-286 (check), 307 (add), 407-408 (check and add)

#### Current Problematic Code

```typescript
// Line 32 (GossipNode interface):
seenMessages: Set<string>;

// Line 70 (constructor):
seenMessages: new Set(),

// Line 307 (processReceivedMessage):
node.seenMessages.add(message.id);

// Line 407-408 (queueMessage):
if (!this.node.seenMessages.has(message.id)) {
  this.node.seenMessages.add(message.id);
```

The `seenMessages` Set grows unboundedly. Every message ID is added and never removed. At gossip interval of 100ms with 10 messages per round, that is 100 messages/second = 8.64M entries/day per node. Each string ID is ~40 bytes, so ~345MB/day. With multi-node propagation, easily 3.2GB/day.

#### Proposed Fix: Bounded LRU Set

Implement a bounded set that evicts the oldest entries when capacity is reached. Use a simple approach with a Map (which preserves insertion order in JavaScript) as the backing store.

```typescript
/**
 * Bounded set that evicts oldest entries when capacity is reached.
 * Uses Map insertion-order for O(1) operations.
 */
class BoundedSet<T> {
  private map = new Map<T, true>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  has(value: T): boolean {
    return this.map.has(value);
  }

  add(value: T): void {
    if (this.map.has(value)) return;

    if (this.map.size >= this.maxSize) {
      // Evict oldest (first inserted)
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
    this.map.set(value, true);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
```

Then update the GossipNode interface and all initialization sites:

```typescript
// BEFORE:
export interface GossipNode {
  // ...
  seenMessages: Set<string>;
}

// AFTER:
export interface GossipNode {
  // ...
  seenMessages: BoundedSet<string>;
}

// In constructor (line 70):
// BEFORE:
seenMessages: new Set(),
// AFTER:
seenMessages: new BoundedSet(100_000), // 100K messages ~= 4MB, covers ~16 minutes at max throughput

// In addNode (line 93):
// BEFORE:
seenMessages: new Set(),
// AFTER:
seenMessages: new BoundedSet(100_000),
```

The BoundedSet size of 100,000 entries provides:
- At 100 msgs/sec: ~16 minutes of history
- Memory: ~4MB per node (100K * ~40 bytes/key)
- Message TTL of 10 hops at 100ms interval = 1 second, so 16 minutes of history is more than sufficient to prevent duplicate processing.

#### Verification

1. Unit test: create BoundedSet with maxSize=5, add 10 items, verify size stays at 5 and oldest entries are evicted.
2. Unit test: verify `has()` returns false for evicted entries.
3. Integration test: run gossip protocol with 100 nodes and 10K messages, verify memory stays bounded.
4. Verify no duplicate message processing occurs (the TTL + maxHops should ensure messages expire before the set evicts them).

#### Risk Assessment

- **Low risk**: The only behavioral change is that very old message IDs may be forgotten, allowing a re-delivery. But messages also have TTL and hop counts that independently prevent infinite propagation. The 100K capacity is conservative -- at max throughput, it covers 16 minutes of messages while messages only live for ~1 second (10 hops * 100ms).

---

### PERF-02: N+1 Sequential AgentDB Bulk Operations

**File**: `v3/@claude-flow/memory/src/agentdb-backend.ts:415-466`

#### Current Problematic Code

```typescript
// bulkInsert (line 415-419):
async bulkInsert(entries: MemoryEntry[]): Promise<void> {
  for (const entry of entries) {
    await this.store(entry);  // Sequential! Each store is a separate DB transaction
  }
}

// bulkDelete (line 424-432):
async bulkDelete(ids: string[]): Promise<number> {
  let deleted = 0;
  for (const id of ids) {
    if (await this.delete(id)) {  // Sequential!
      deleted++;
    }
  }
  return deleted;
}

// clearNamespace (line 454-466):
async clearNamespace(namespace: string): Promise<number> {
  const ids = this.namespaceIndex.get(namespace);
  if (!ids) return 0;
  let deleted = 0;
  for (const id of ids) {
    if (await this.delete(id)) {  // Sequential!
      deleted++;
    }
  }
  return deleted;
}
```

For 1000 entries, this means 1000 sequential awaits. Each `store()` and `delete()` does its own SQLite transaction.

#### Proposed Fix

Wrap bulk operations in a single SQLite transaction, and use `Promise.all` with batching for non-DB operations (like in-memory index updates).

```typescript
// AFTER -- bulkInsert:
async bulkInsert(entries: MemoryEntry[]): Promise<void> {
  if (entries.length === 0) return;

  // Use a single transaction for all inserts
  if (this.db) {
    this.db.run('BEGIN TRANSACTION');
    try {
      for (const entry of entries) {
        await this.store(entry);
      }
      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  } else {
    // Fallback: in-memory only, batch with Promise.all (bounded concurrency)
    const BATCH_SIZE = 50;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(entry => this.store(entry)));
    }
  }
}

// AFTER -- bulkDelete:
async bulkDelete(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  let deleted = 0;
  if (this.db) {
    this.db.run('BEGIN TRANSACTION');
    try {
      for (const id of ids) {
        if (await this.delete(id)) {
          deleted++;
        }
      }
      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  } else {
    for (const id of ids) {
      if (await this.delete(id)) {
        deleted++;
      }
    }
  }
  return deleted;
}

// AFTER -- clearNamespace:
async clearNamespace(namespace: string): Promise<number> {
  const ids = this.namespaceIndex.get(namespace);
  if (!ids || ids.size === 0) return 0;

  // Copy IDs to avoid modifying set during iteration
  const idList = Array.from(ids);
  return this.bulkDelete(idList);
}
```

Note: Whether `this.db` exists depends on the backend configuration. The agentdb-backend uses either in-memory Maps or a SQLite database. Check the `store()` and `delete()` methods to see if they internally call `this.db.run()`. If so, wrapping in a single transaction eliminates per-statement transaction overhead (the main bottleneck).

#### Verification

1. Benchmark: bulkInsert 1000 entries before and after. Expect >10x speedup with transaction batching.
2. Benchmark: bulkDelete 500 entries before and after.
3. Verify atomicity: if one insert fails mid-batch, all should be rolled back.
4. Verify clearNamespace still removes all entries for the given namespace.

#### Risk Assessment

- **Low risk**: SQLite transactions are well-understood. The main risk is that a failure mid-batch now rolls back the entire batch instead of keeping partial progress. This is actually better behavior (atomic bulk operations).
- **Note**: Need to verify that `this.store()` does not internally call `BEGIN/COMMIT` (nested transactions). If it does, use SAVEPOINTs or skip the inner transaction boundaries.

---

### PERF-03: CLI Loads All 35+ Commands Synchronously

**File**: `v3/@claude-flow/cli/src/commands/index.ts:118-155`

#### Current Problematic Code

The file has lazy-loading infrastructure (lines 24-77, `commandLoaders` map) but it is completely unused because lines 118-155 synchronously import ALL 35+ command modules:

```typescript
// Lines 118-155: ALL synchronous imports
import { initCommand } from './init.js';
import { startCommand } from './start.js';
import { statusCommand } from './status.js';
// ... 32 more synchronous imports ...
import { autopilotCommand } from './autopilot.js';
```

Lines 157-177 then populate the `loadedCommands` cache, and lines 238-261 use the imported symbols in the `commands` array.

The `commandsByCategory` export (line 266-313) uses ALL imported commands including rarely-used ones like `configCommand`, `completionsCommand`, `migrateCommand`, `workflowCommand`, `analyzeCommand`, `routeCommand`, `progressCommand`, `providersCommand`, `pluginsCommand`, `deploymentCommand`, `claimsCommand`, `issuesCommand`, `updateCommand`, `processCommand`, `applianceCommand`.

#### Proposed Fix

Split into two groups:

1. **Core commands** (needed for `commands` array and help display): Keep synchronous, but limit to ~10 most-used commands.
2. **Extended commands** (needed only for `commandsByCategory`): Load asynchronously on demand.

```typescript
// ===== KEEP SYNCHRONOUS (truly core, needed at startup) =====
import { initCommand } from './init.js';
import { startCommand } from './start.js';
import { statusCommand } from './status.js';
import { taskCommand } from './task.js';
import { sessionCommand } from './session.js';
import { agentCommand } from './agent.js';
import { swarmCommand } from './swarm.js';
import { memoryCommand } from './memory.js';
import { mcpCommand } from './mcp.js';
import { hooksCommand } from './hooks.js';

// ===== LAZY-LOAD ON DEMAND =====
// Remove all other synchronous imports.
// The commandLoaders map (lines 24-77) already has lazy loaders for all commands.

// Change the commands array to only include core commands:
export const commands: Command[] = [
  initCommand,
  startCommand,
  statusCommand,
  taskCommand,
  sessionCommand,
  agentCommand,
  swarmCommand,
  memoryCommand,
  mcpCommand,
  hooksCommand,
];

// Change commandsByCategory to use async loading:
export async function getCommandsByCategory(): Promise<Record<string, Command[]>> {
  const [
    daemonCmd, doctorCmd, embeddingsCmd, neuralCmd,
    performanceCmd, securityCmd, ruvectorCmd, hiveMindCmd,
    configCmd, completionsCmd, migrateCmd, workflowCmd,
    analyzeCmd, routeCmd, progressCmd, providersCmd,
    pluginsCmd, deploymentCmd, claimsCmd, issuesCmd,
    updateCmd, processCmd, guidanceCmd, applianceCmd,
    cleanupCmd, autopilotCmd,
  ] = await Promise.all([
    loadCommand('daemon'), loadCommand('doctor'), loadCommand('embeddings'), loadCommand('neural'),
    loadCommand('performance'), loadCommand('security'), loadCommand('ruvector'), loadCommand('hive-mind'),
    loadCommand('config'), loadCommand('completions'), loadCommand('migrate'), loadCommand('workflow'),
    loadCommand('analyze'), loadCommand('route'), loadCommand('progress'), loadCommand('providers'),
    loadCommand('plugins'), loadCommand('deployment'), loadCommand('claims'), loadCommand('issues'),
    loadCommand('update'), loadCommand('process'), loadCommand('guidance'), loadCommand('appliance'),
    loadCommand('cleanup'), loadCommand('autopilot'),
  ]);

  return {
    primary: [
      initCommand, startCommand, statusCommand, agentCommand,
      swarmCommand, memoryCommand, taskCommand, sessionCommand,
      mcpCommand, hooksCommand,
    ],
    advanced: [
      neuralCmd, securityCmd, performanceCmd, embeddingsCmd,
      hiveMindCmd, ruvectorCmd, guidanceCmd, autopilotCmd,
    ].filter(Boolean) as Command[],
    utility: [
      configCmd, doctorCmd, daemonCmd, completionsCmd,
      migrateCmd, workflowCmd,
    ].filter(Boolean) as Command[],
    analysis: [
      analyzeCmd, routeCmd, progressCmd,
    ].filter(Boolean) as Command[],
    management: [
      providersCmd, pluginsCmd, deploymentCmd, claimsCmd,
      issuesCmd, updateCmd, processCmd, applianceCmd, cleanupCmd,
    ].filter(Boolean) as Command[],
  };
}

// Keep synchronous export for backwards compatibility, but mark deprecated
/** @deprecated Use getCommandsByCategory() instead */
export const commandsByCategory = { primary: commands, advanced: [], utility: [], analysis: [], management: [] };
```

The CLI's main entry point needs to be updated to call `getCommandsByCategory()` when displaying help or finding commands, and to use `loadCommand(name)` for command execution.

#### Verification

1. Benchmark: measure CLI startup time (`time npx @claude-flow/cli@latest --help`) before and after. Target: >30% reduction.
2. Functional: all 35+ commands still work when invoked by name.
3. Functional: `--help` output still shows all commands organized by category.
4. Regression: existing `import { someCommand } from './commands/index.js'` consumers need to check if they use removed synchronous exports.

#### Risk Assessment

- **High risk**: This change affects the public API of the commands index module. Any code that imports specific commands synchronously (e.g., `import { embeddingsCommand } from './commands/index.js'`) will break. Need to:
  1. Audit all import sites across the codebase.
  2. Keep the synchronous `export { ... }` statements but change them to lazy re-exports if possible, or maintain them as deprecated synchronous imports.
  3. Test all CLI commands end-to-end.

---

## Dependency Graph

```
CRIT-01 (SQL injection)         -- Independent, can start immediately
CRIT-02 (command injection)     -- Independent, can start immediately
CRIT-03 (browser eval)          -- Independent, can start immediately

HIGH-01 (ESLint rule)           -- Depends on CRIT-02 (need to fix before we can enforce)
HIGH-02 (skip-permissions)      -- Independent
HIGH-03 (JSON.parse)            -- Independent
HIGH-04 (plugin sandboxing)     -- Independent (logging only)
HIGH-05 (HNSW hash)             -- Independent

PERF-01 (gossip seenMessages)   -- Independent
PERF-02 (AgentDB bulk ops)      -- Independent
PERF-03 (CLI lazy loading)      -- Should be done last (most disruptive)
```

**Recommended execution order:**

```
Phase 1 (parallel):  CRIT-01 + CRIT-02 + CRIT-03 + HIGH-02 + HIGH-03
Phase 2 (parallel):  HIGH-01 + HIGH-04 + HIGH-05 + PERF-01 + PERF-02
Phase 3 (solo):      PERF-03 (requires careful backwards-compat testing)
```

---

## Rollout Plan

### Commit Strategy

All fixes should be committed as a single logical change set with the following structure:

1. **Commit A**: CRIT-01 + CRIT-02 + CRIT-03 (critical security -- backport priority)
2. **Commit B**: HIGH-01 through HIGH-05 (high security)
3. **Commit C**: PERF-01 + PERF-02 (performance, low risk)
4. **Commit D**: PERF-03 (CLI lazy loading, higher risk, separate for easy revert)

### Cherry-pick to main

```bash
git cherry-pick <commit-A> <commit-B> <commit-C> <commit-D>
```

Or squash into a single commit for the PR.

### PR Description

Title: `fix: remediate critical security vulns + performance issues (v3.5.73)`

Body should reference each issue ID (CRIT-01 through PERF-03) with brief description of the fix.

---

## Complexity Summary

| Issue | Files Changed | Lines Changed (est.) | Risk |
|-------|---------------|---------------------|------|
| CRIT-01 | 1 | ~60 | Low |
| CRIT-02 | 7-10 | ~150 | Medium |
| CRIT-03 | 1 | ~40 | Low |
| HIGH-01 | 1-2 (config) | ~20 | Low |
| HIGH-02 | 1 | ~1 | Very Low |
| HIGH-03 | 3 | ~15 | Very Low |
| HIGH-04 | 1-2 | ~20 | Very Low |
| HIGH-05 | 1 | ~40 | Medium |
| PERF-01 | 1 | ~50 | Low |
| PERF-02 | 1 | ~40 | Low |
| PERF-03 | 2-3 | ~120 | High |
| **Total** | **~15-20** | **~556** | **Medium** |

### Success Criteria

**Milestone 1 (Critical Security):**
- Zero SQL injection vectors in embeddings commands (parameterized queries only)
- Zero command injection vectors via user-controlled strings in execSync
- Browser eval validates input and blocks dangerous patterns
- All existing CLI commands still pass functional tests

**Milestone 2 (High Security):**
- ESLint rule prevents future direct child_process imports
- `--dangerously-skip-permissions` requires explicit opt-in
- All memory backends use safeJsonParse for deserialization
- HNSW hash collision rate < 1 in 10 million at 100K entries

**Milestone 3 (Critical Performance):**
- Gossip protocol memory bounded to ~4MB/node regardless of runtime duration
- bulkInsert of 1000 entries completes in <1 second (was: ~10+ seconds with N+1)
- CLI startup time reduced by >30% (was: loading 35+ modules synchronously)
