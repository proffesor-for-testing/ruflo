# Test Quality and Coverage Analysis Report

**Project**: Ruflo v3.5  
**Date**: 2026-04-08  
**Analyst**: QE Test Architect (Agentic QE v3)  
**Scope**: 363 test files across v3 packages, plugins, v2 legacy, and root-level tests  
**Files Reviewed**: 22 test files read in detail, full project scan of all 363 test files

---

## Executive Summary

The Ruflo v3.5 test suite contains **363 test files** across 21 packages, 12+ plugins, integration suites, and legacy v2 tests. The suite demonstrates strong patterns in some areas (security, guidance, memory) but reveals significant gaps in others (neural, shared, mcp, providers). Several critical anti-patterns were found, including tautological assertions, placeholder tests, and timing-dependent logic.

**Overall Quality Score: 6.2/10**

| Metric | Score | Assessment |
|--------|-------|------------|
| Coverage breadth | 5/10 | Multiple packages under 15% test-to-source ratio |
| Assertion quality | 7/10 | Strong in security/memory, weak in hooks/deployment |
| Test architecture | 6/10 | Good isolation but pyramid inverted |
| Anti-pattern prevalence | 5/10 | 9 tautological assertions, placeholder tests found |
| Framework consistency | 8/10 | Vitest used consistently in v3; v2 has mixed frameworks |

---

## 1. Coverage Gaps

### 1.1 Test-to-Source Ratio by Package

| Package | Test Files | Source Files | Ratio | Assessment |
|---------|-----------|-------------|-------|------------|
| **guidance** | 26 | 34 | **76%** | Excellent |
| **security** | 13 | 17 | **76%** | Excellent |
| **embeddings** | 6 | 12 | 50% | Good |
| **browser** | 7 | 14 | 50% | Good |
| **claims** | 5 | 18 | 27% | Below target |
| **hooks** | 5 | 18 | 27% | Below target |
| **plugins** | 13 | 52 | 25% | Below target |
| **performance** | 3 | 13 | 23% | Below target |
| **memory** | 9 | 42 | 21% | Below target |
| **codex** | 3 | 15 | 20% | Below target |
| **integration** | 3 | 17 | 17% | Critical gap |
| **aidefence** | 1 | 6 | 16% | Critical gap |
| **cli** | 28 | 184 | **15%** | Critical gap (largest package) |
| **testing** | 5 | 33 | 15% | Critical gap |
| **deployment** | 1 | 8 | **12%** | Critical gap |
| **swarm** | 4 | 32 | **12%** | Critical gap |
| **mcp** | 2 | 18 | **11%** | Critical gap |
| **shared** | 8 | 76 | **10%** | Critical gap (foundation package) |
| **neural** | 3 | 29 | **10%** | Critical gap |
| **providers** | 1 | 11 | **9%** | Critical gap |

### 1.2 Packages with Critical Test Debt

**@claude-flow/shared** (10% coverage, 76 source files): This is the foundation package shared across all other packages. With only 8 test files covering hooks and events, the vast majority of shared utilities, types, and infrastructure code has zero test coverage. This represents the highest-risk gap in the project.

**@claude-flow/cli** (15% coverage, 184 source files): The largest package with 184 source files but only 28 test files. While the tests that exist are well-written (see Section 2), the 26 CLI commands and 140+ subcommands have minimal coverage. The RuVector subsystem has good test coverage but command handlers, MCP tools, and services are undertested.

**@claude-flow/neural** (10% coverage, 29 source files): Only 3 test files for a package with SONA, MoE, HNSW, and Flash Attention implementations. The SONA test uses comprehensive mocking (good pattern) but the actual neural algorithms have minimal coverage.

**@claude-flow/swarm** (12% coverage, 32 source files): The coordinator test is excellent (detailed below) but consensus algorithms, topology management, and the queen-coordinator system are severely undertested.

**@claude-flow/mcp** (11% coverage, 18 source files): Only 2 test files (plus 3 in v3/mcp/) for the MCP server that exposes 314+ tools. This is a critical boundary of the system.

### 1.3 Untested Source Areas (Sampled)

The following source modules were identified as having zero corresponding test files:

- `@claude-flow/cli/src/mcp-tools/*.ts` (12+ tool files, partial coverage via honesty tests only)
- `@claude-flow/cli/src/commands/*.ts` (most command handlers)
- `@claude-flow/shared/src/types/*.ts` (core type definitions)
- `@claude-flow/neural/src/hnsw*.ts` (HNSW vector search)
- `@claude-flow/neural/src/flash-attention*.ts` (Flash Attention)
- `@claude-flow/swarm/src/consensus/*.ts` (consensus algorithms)
- `@claude-flow/mcp/src/handlers/*.ts` (MCP request handlers)

---

## 2. Test Quality Assessment

### 2.1 AAA Pattern Adherence

**Strong examples:**

`v3/@claude-flow/security/__tests__/input-validator.test.ts` (Grade: A)
- Consistently uses clear Arrange-Act-Assert
- Each test has a single concern
- Descriptive test names that read as specifications
- Example:
```typescript
it('should reject strings with shell metacharacters', () => {
  const dangerous = [';', '&&', '||', '|', '`', '$()', '${}', '>', '<'];
  for (const char of dangerous) {
    expect(() => SafeStringSchema.parse(`hello${char}world`)).toThrow();
  }
});
```

`v3/@claude-flow/memory/src/hybrid-backend.test.ts` (Grade: A)
- Proper setup/teardown with beforeEach/afterEach
- Tests real behavior through the dual-write mechanism
- Verifies both SQLite and AgentDB backends independently

`v3/@claude-flow/memory/src/controller-registry.test.ts` (Grade: A+)
- 77 tests covering lifecycle, ordering, degradation, config, access, health, shutdown, events, and performance
- Excellent mock backend implementation
- Tests ADR-053 requirements explicitly

**Weak examples:**

`v3/@claude-flow/deployment/src/__tests__/release-manager.test.ts` (Grade: D)
- Tests version bumping by reimplementing the logic in the test itself (testing the test, not the code)
- Only 2 tests actually exercise the ReleaseManager class; the rest test string manipulation

`v3/@claude-flow/hooks/__tests__/hooks.test.ts` (Grade: F)
- Placeholder test with `expect(true).toBe(true)`
- Tests create their own data structures instead of exercising actual hook implementations
- 3 assertions total across 3 tests, none testing real behavior

### 2.2 Assertion Quality

**Behavior-testing (good):**
- Security tests verify that dangerous inputs are rejected and safe inputs pass
- Memory tests verify data persistence across backends and reinitialization
- Swarm coordinator tests verify state transitions and resource limits
- Guidance compiler tests verify rule parsing, merging, and hash determinism

**Implementation-testing (concerning):**
- CLI tests access private members via `cli['parser']` and `cli['output']['colorEnabled']`
- Some tests check internal property names rather than observable behavior
- Provider integration tests have `try/catch` blocks that swallow errors and pass silently

### 2.3 Mock Usage Assessment

**Well-mocked:**
- `v3/@claude-flow/neural/__tests__/sona.test.ts`: Comprehensive mock engine factory with realistic return values, properly isolated from the real SONA WASM module
- `v3/plugins/code-intelligence/tests/bridges.test.ts`: WASM module mocked cleanly, tests the JavaScript fallback path
- `v3/@claude-flow/cli/__tests__/cli.test.ts`: Process.stdout, stderr, and exit properly mocked with cleanup in afterEach

**Under-mocked (potential flakiness):**
- `v3/@claude-flow/providers/src/__tests__/provider-integration.test.ts`: Tests depend on external API keys and services (Anthropic, Google, OpenRouter, Ollama). Uses `it.skipIf` but some tests silently catch errors
- `v3/__tests__/integration/memory-integration.test.ts`: Creates real files on disk (temporary databases), with cleanup in afterEach that ignores errors -- this risks test pollution

**Over-mocked:**
- Some plugin bridge tests mock so heavily that they only verify the mock itself returns expected values, not that the bridge logic works correctly

### 2.4 Edge Case Coverage

**Strong edge case testing:**
- Input validator: null bytes, path traversal, shell metacharacters, boundary lengths
- Bash safety hook: fork bombs, pipe injection, secret detection patterns, DD commands
- Embeddings: zero vectors, orthogonal vectors, round-trip conversions, Poincare ball bounds
- Claims service: empty portfolios, concurrent operations

**Missing edge cases:**
- No null/undefined input tests for most packages
- No prototype pollution tests
- No integer overflow tests for performance metrics
- No unicode/emoji handling tests
- No resource exhaustion tests (OOM, file descriptor limits)

---

## 3. Test Architecture

### 3.1 Test Pyramid Analysis

| Category | Count | Percentage | Target |
|----------|-------|------------|--------|
| **Unit tests** (by directory convention) | 5 | 2.3% | 70% |
| **Integration tests** (by directory convention) | 9 | 4.2% | 20% |
| **E2E tests** (by directory convention) | 1 | 0.5% | 10% |
| **Acceptance tests** | 1 | 0.5% | - |
| **Uncategorized** (in `__tests__/` or `tests/`) | 197 | 92.5% | - |

**The test pyramid is not meaningfully implemented.** 92.5% of V3 test files are in flat `__tests__/` or `tests/` directories with no explicit categorization. While many of these are effectively unit tests, the lack of organization makes it impossible to run test layers independently or enforce pyramid ratios.

**Recommendation**: Adopt a convention like `__tests__/unit/`, `__tests__/integration/`, `__tests__/e2e/` and configure Vitest with separate configs or glob patterns for each layer.

### 3.2 Test Isolation

**Good isolation:**
- Most test files use `beforeEach` to create fresh instances
- Memory tests use `:memory:` SQLite databases or temporary files
- Mock restoration via `vi.restoreAllMocks()` in afterEach

**Isolation concerns:**
- `v3/@claude-flow/swarm/__tests__/coordinator.test.ts`: Line 455 uses `await new Promise(resolve => setTimeout(resolve, 2500))` to wait for a health check interval -- this is a timing-dependent assertion that can flake under load
- `v3/@claude-flow/mcp/__tests__/integration.test.ts`: Multiple `setTimeout` calls with 10-50ms delays
- `v3/@claude-flow/shared/src/hooks/hooks.test.ts`: 200ms setTimeout in tests
- `v3/@claude-flow/providers/src/__tests__/provider-integration.test.ts`: Tests depend on external services being available
- `v3/__tests__/integration/memory-integration.test.ts`: Creates real database files that could collide in parallel runs (uses `Date.now()` for uniqueness)

### 3.3 Test Data Management

**Patterns observed:**
- Factory functions for test data (`createTestCapabilities()`, `createTestMetrics()`, `createMockEngine()`) -- good pattern
- Inline test data in individual tests -- acceptable for simple cases
- `createDefaultEntry()` helper in memory tests -- good reuse
- `createMockBackend()` with full IMemoryBackend implementation -- excellent pattern

**Missing:**
- No shared test fixture library across packages
- No faker/factory library for generating realistic test data
- No test data builders (Builder pattern)
- No snapshot testing for complex output verification

---

## 4. Flaky Test Indicators

### 4.1 Timing-Dependent Tests

| File | Line | Pattern | Risk |
|------|------|---------|------|
| `swarm/coordinator.test.ts` | 455 | `setTimeout(resolve, 2500)` waiting for health check | HIGH |
| `mcp/integration.test.ts` | 233-321 | Multiple `setTimeout` calls (10-50ms) | HIGH |
| `shared/hooks/hooks.test.ts` | 302 | `setTimeout(resolve, 200)` | MEDIUM |
| `shared/hooks/session-hooks.test.ts` | 53, 132 | `setTimeout(resolve, 5-10)` | MEDIUM |
| `cli/headless-worker-executor.test.ts` | Multiple | Heavy setTimeout usage in test implementation | HIGH |

### 4.2 External Dependency Tests

| File | Dependency | Mitigation |
|------|-----------|------------|
| `providers/provider-integration.test.ts` | Anthropic API, Google API, Ollama | `it.skipIf` + try/catch |
| `v3/__tests__/honesty/tool-honesty.test.ts` | Source file existence | `existsSync` check |

### 4.3 Shared State Risks

- `guidance/tests/wasm-kernel.test.ts`: Module-level `let wasm` and `let wasmAvailable` -- mutation between tests possible
- `guidance/tests/capabilities.test.ts`: Module-level `let algebra` -- could carry state between describe blocks

---

## 5. Missing Test Categories

### 5.1 Security Tests

| Package | Has Security Tests? | Notes |
|---------|-------------------|-------|
| **security** | Yes (13 files) | Comprehensive input validation, path validation, safe execution |
| **shared** | Yes (bash-safety) | Good coverage of command injection, secret detection |
| **aidefence** | Yes (1 file) | Threat detection, PII detection, jailbreak prevention |
| **cli** | Yes (security-audit) | 1 file for CLI security |
| All other packages | **No** | No security-specific tests |

**Missing**: No security tests for MCP boundary inputs, swarm message authentication, memory access control, plugin sandboxing, or deployment credential handling.

### 5.2 Performance/Benchmark Tests

| Package | Has Performance Tests? | Notes |
|---------|----------------------|-------|
| **performance** | Yes (3 files) | Attention, benchmarks |
| **memory** | Yes (benchmark.test.ts) | Memory operation benchmarks |
| **guidance** | Yes (benchmark.test.ts) | Compiler benchmarks |
| **code-intelligence** | Partial | Performance assertions in bridge tests |

**Missing**: No performance regression tests for CLI startup time, MCP response latency, swarm coordination overhead, or HNSW search speed. These are all claimed in documentation with specific targets (e.g., "<500ms CLI startup", "<100ms MCP response") but have no automated verification.

### 5.3 Contract Tests Between Packages

**No contract tests exist.** Packages communicate through TypeScript interfaces and direct imports, but there are no tests verifying that:
- Memory backends implement the full IMemoryBackend interface correctly
- MCP tools conform to their declared input schemas at runtime
- Plugin bridges maintain backward compatibility
- V2-to-V3 compatibility mappings are complete

The `testing/src/v2-compat/` directory has compatibility test files, but these are the only cross-package contract tests found.

### 5.4 Error Handling Tests

**Good error handling coverage:**
- Security input validator: rejection of invalid inputs
- Bash safety hook: dangerous command blocking
- Swarm coordinator: max agents exceeded
- CLI: unknown commands, missing required options, command execution errors

**Missing error handling tests:**
- No tests for network failure recovery in providers
- No tests for database corruption recovery in memory
- No tests for WASM module load failures in neural
- No tests for concurrent operation conflicts in swarm
- No tests for graceful degradation when optional services are unavailable (only ControllerRegistry tests this)

---

## 6. Test Anti-Patterns

### 6.1 Tautological Assertions (Tests That Never Fail)

**9 instances found across the codebase:**

| File | Line | Code |
|------|------|------|
| `hooks/__tests__/hooks.test.ts` | 6 | `expect(true).toBe(true)` |
| `testing/__tests__/framework.test.ts` | 6 | `expect(true).toBe(true)` |
| `shared/hooks/verify-exports.test.ts` | 46 | `expect(true).toBe(true)` |
| `cli/ruvector/coverage-router.test.ts` | 674 | `expect(true).toBe(true)` |
| `browser/reasoningbank-adapter.test.ts` | 152 | `expect(true).toBe(true)` |
| `swarm/topology.test.ts` | 466, 536 | `expect(true).toBe(true)` (2 instances) |
| `hooks/guidance-provider.test.ts` | 213 | `expect(true).toBe(true)` |
| `prime-radiant/coherence-check.test.ts` | 456 | `expect(true).toBe(true)` |

These tests provide zero value and create a false sense of coverage. They should be replaced with real assertions or removed.

### 6.2 Placeholder/Skeleton Tests

`v3/@claude-flow/hooks/__tests__/hooks.test.ts` is the most egregious example -- the entire file is 28 lines with 3 tests, one of which is `expect(true).toBe(true)` and the other two create their own Map/Array instead of testing the actual hooks module. This file gives the appearance of test coverage while testing nothing.

`v3/@claude-flow/deployment/src/__tests__/release-manager.test.ts` has only 2 tests that actually instantiate ReleaseManager (and only call the constructor). The remaining tests reimplement version bumping logic inline rather than testing the module's methods.

### 6.3 Error Swallowing

```typescript
// v3/@claude-flow/providers/src/__tests__/provider-integration.test.ts
} catch (error) {
  console.log('RuVector/Ollama not available, test details:', error);
  // Don't fail - local models may not be running
}
```

This pattern causes tests to pass silently even when the code under test throws unexpected errors. Found in multiple tests in the providers integration test file.

### 6.4 Testing Implementation Not Behavior

```typescript
// v3/@claude-flow/cli/__tests__/cli.test.ts
expect(cli['output']['colorEnabled']).toBe(false);
```

Accessing private members via bracket notation couples tests to implementation details. If the internal structure changes, these tests break even if the behavior is correct.

### 6.5 Duplicated Test Boilerplate

The plugin test files (`financial-risk/tests/bridges.test.ts`, `code-intelligence/tests/bridges.test.ts`, `healthcare-clinical/tests/bridges.test.ts`, etc.) follow an identical template pattern with near-identical test structures. While this ensures consistency, it also means:
- Tests may not cover plugin-specific edge cases
- Changes to the template must be propagated to 12+ files manually
- The "tests" may be testing the template rather than the plugin

### 6.6 Skipped Tests

**Files with highest skip counts:**

| File | Skipped Tests |
|------|--------------|
| `guidance/tests/analyzer.test.ts` | 110 |
| `cli/__tests__/p1-commands.test.ts` | 28 |
| `agentic-qe/__tests__/tools/analyze-coverage.test.ts` | 25 |
| `cli/__tests__/commands.test.ts` | 25 |
| `cli/__tests__/cli.test.ts` | 25 |
| `cli/__tests__/ruvector/ast-analyzer.test.ts` | 22 |
| `browser/tests/e2e/browser-e2e.test.ts` | 12 |
| `security/__tests__/integration/security-flow.test.ts` | 10 |

The guidance analyzer has **110 skipped tests**, which represents a massive amount of planned but unimplemented test coverage. The CLI has multiple files with 25+ skips each.

---

## 7. Framework Assessment

### 7.1 Framework Consistency

| Area | Framework | Configuration |
|------|-----------|--------------|
| V3 packages | Vitest | Per-package vitest.config.ts |
| V3 plugins | Vitest | Shared configuration |
| V3 cross-cutting | Vitest | Root-level config |
| V2 legacy | Mixed (Vitest + custom utils) | Custom test.utils.ts adapter |
| Root tests | Vitest | Root vitest.config.ts |

**Vitest is used consistently across v3.** The v2 layer uses a custom `test.utils.ts` that wraps assertions (`assertEquals`, `assertExists`) in a Vitest-compatible interface.

### 7.2 Configuration Issues

- **12 separate vitest.config.ts files** across packages (cli, mcp, embeddings, browser, swarm, claims, plugins, hooks, memory, codex, security, shared). This fragmentation means:
  - No unified coverage reporting
  - Different timeout/retry settings per package
  - Inconsistent test runner behavior
  - Cannot run full suite with a single command easily

- **No coverage thresholds configured** in any vitest config file observed

- **No watch-mode guards** beyond the project rule to use `--run` flag

### 7.3 Console Output Pollution

**16 test files** contain `console.log`, `console.warn`, or `console.error` calls. The provider integration test is the worst offender with multiple `console.log` statements for debugging. This pollutes CI output and can mask real warnings.

---

## 8. Positive Patterns Found

### 8.1 Tool Honesty Tests (Exemplary)

`v3/__tests__/honesty/tool-honesty.test.ts` is an outstanding example of meta-testing. It reads source files and verifies:
- No `Math.random()` used for metrics/confidence scores
- No fake delays via `setTimeout`
- No auto-completion of workflow steps
- Real OS values used for system metrics
- Honest stub markers (`_stub: true`) when features are unavailable
- Real timing via `performance.now()` in benchmarks

This is a pattern that should be replicated across more of the codebase.

### 8.2 Security Tests

The `@claude-flow/security` and `@claude-flow/shared/hooks/bash-safety` test suites are the gold standard for the project:
- Comprehensive boundary value testing
- Real-world attack patterns tested (XSS, SQL injection, path traversal, shell injection)
- Both positive and negative cases
- Clear, descriptive test names
- Good use of parameterized test data

### 8.3 Controller Registry Tests

`v3/@claude-flow/memory/src/controller-registry.test.ts` (777 lines, 77 tests) demonstrates:
- Comprehensive lifecycle testing (init, shutdown, re-init)
- Graceful degradation testing (missing dependencies)
- Config-driven activation testing
- Event emission verification
- Performance assertions with explicit ADR references
- Clean mock backend implementation

### 8.4 Hybrid Backend Tests

`v3/@claude-flow/memory/src/hybrid-backend.test.ts` demonstrates good integration testing:
- Tests both backends independently and together
- Verifies data consistency across storage layers
- Tests CRUD operations, bulk operations, namespace isolation
- Uses `:memory:` databases for speed and isolation

---

## 9. Recommendations

### Priority 1: Critical Gaps (address within 2 weeks)

1. **Replace all 9 tautological assertions** with real tests or remove the test files entirely
2. **Add tests for @claude-flow/shared** -- this foundation package with 76 source files and 10% coverage is the highest-risk gap
3. **Add MCP boundary tests** -- the MCP server exposes 314+ tools but has only 2 test files; add input validation and schema conformance tests
4. **Fix the 110 skipped tests** in `guidance/analyzer.test.ts` -- implement or remove them
5. **Remove error-swallowing try/catch blocks** in provider integration tests; use `it.skipIf` instead

### Priority 2: Structural Improvements (address within 1 month)

6. **Implement test pyramid conventions** -- reorganize test directories into `unit/`, `integration/`, `e2e/` and create separate Vitest configs for each layer
7. **Add contract tests** between packages, especially for IMemoryBackend implementations and MCP tool schemas
8. **Eliminate timing-dependent tests** -- replace `setTimeout` waits with event-driven assertions or fake timers (`vi.useFakeTimers()`)
9. **Create shared test utilities** -- extract factory functions, mock backends, and test data builders into a `@claude-flow/testing` package
10. **Consolidate Vitest configuration** -- create a root config with per-package overrides to enable unified coverage reporting

### Priority 3: Quality Enhancement (ongoing)

11. **Add property-based tests** (fast-check) for input validation, serialization/deserialization, and mathematical operations
12. **Add performance regression tests** that verify documented targets (CLI <500ms, MCP <100ms, HNSW 150x+)
13. **Add security tests** for each package's public API boundary
14. **Set coverage thresholds** in Vitest configs (80% for new code, 60% for existing code)
15. **Suppress console output** in tests -- mock console methods or use Vitest's `--silent` flag

### Priority 4: Plugin Test Quality

16. **Differentiate plugin tests from templates** -- the current templated approach (bridges.test.ts, types.test.ts, mcp-tools.test.ts) provides structural coverage but misses plugin-specific edge cases. Each plugin should have at least one test file testing its unique behavior.

---

## Appendix A: Files Reviewed in Detail

| File | Lines | Tests | Assertions | Grade |
|------|-------|-------|------------|-------|
| `security/__tests__/input-validator.test.ts` | 381 | 34 | 45+ | A |
| `cli/__tests__/cli.test.ts` | 563 | 25 | 35+ | B+ |
| `memory/src/hybrid-backend.test.ts` | 399 | 17 | 30+ | A |
| `swarm/__tests__/coordinator.test.ts` | 502 | 20 | 40+ | A- |
| `__tests__/honesty/tool-honesty.test.ts` | 401 | 18 | 50+ | A+ |
| `guidance/tests/compiler.test.ts` | 225 | 11 | 25+ | A |
| `plugins/code-intelligence/tests/bridges.test.ts` | 268 | 17 | 20+ | B |
| `plugins/code-intelligence/tests/types.test.ts` | 543 | 38 | 55+ | A |
| `neural/__tests__/sona.test.ts` | 446 | 20 | 30+ | B+ |
| `embeddings/__tests__/embeddings.test.ts` | 300 | 25 | 35+ | A |
| `hooks/__tests__/hooks.test.ts` | 28 | 3 | 3 | F |
| `deployment/src/__tests__/release-manager.test.ts` | 72 | 7 | 12 | D |
| `aidefence/__tests__/threat-detection.test.ts` | 175 | 17 | 25+ | A- |
| `plugins/financial-risk/tests/bridges.test.ts` | 307 | 22 | 25+ | B |
| `providers/src/__tests__/provider-integration.test.ts` | 447 | 8 | 15+ | C |
| `shared/__tests__/hooks/bash-safety.test.ts` | 289 | 28 | 40+ | A |
| `__tests__/integration/memory-integration.test.ts` | 413 | 13 | 25+ | B+ |
| `v2/tests/unit/mcp/server.test.ts` | 182 | 12 | 15+ | B- |
| `claims/tests/claim-service.test.ts` | ~300 | 15+ | 30+ | B |
| `memory/src/controller-registry.test.ts` | 777 | 77 | 100+ | A+ |
| `shared/__tests__/hooks/bash-safety.test.ts` | 289 | 28 | 40+ | A |
| `plugins/code-intelligence/tests/bridges.test.ts` | 268 | 17 | 20+ | B |

---

## Appendix B: Anti-Pattern Density Map

```
Package                    Tautological  Placeholder  Timing  Error-Swallow  Skip
---------------------------------------------------------------------------
hooks                      2             1            0       0              0
testing                    1             1            0       0              0
shared                     1             0            2       0              5
cli                        1             0            3       0              83
swarm                      2             0            0       0              4
browser                    1             0            0       0              12
plugins (prime-radiant)    1             0            0       0              0
plugins (cognitive-kernel) 0             0            0       0              15
guidance                   0             0            0       0              110
security                   0             0            0       0              18
providers                  0             0            0       3              8
mcp                        0             0            5       0              0
deployment                 0             1            0       0              0
---------------------------------------------------------------------------
TOTAL                      9             3            10      3              255
```

---

*Report generated by QE Test Architect. For questions or follow-up analysis, reference this report as QE-04.*
