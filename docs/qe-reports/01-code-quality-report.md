# Code Quality & Complexity Analysis Report

**Project**: Ruflo v3.5 (claude-flow monorepo)  
**Date**: 2026-04-08  
**Scope**: `v3/@claude-flow/` -- 21 packages, 649 source files, 328,907 lines of TypeScript  
**Analyzer**: QE Code Complexity Analyzer v3  

---

## Executive Summary

The Ruflo v3.5 codebase exhibits **serious file-size violations** (258 of 649 source files exceed the project's 500-line limit), **concentrated complexity in the CLI package**, and **moderate type-safety concerns** (`any` usage in 40+ files, 90 unsafe casts). Architectural separation is generally good at the package level, but several DDD boundary violations exist where the CLI package reaches directly into swarm domain internals via relative imports. The most critical hotspot is the `hooks.ts` command file at 5,237 lines -- over ten times the project's own 500-line rule.

---

## Summary Metrics

| Metric | Value | Status |
|--------|-------|--------|
| Total Source Files | 649 | -- |
| Total Lines of Code | 328,907 | -- |
| Files > 500 lines (project limit) | 258 (39.8%) | **CRITICAL** |
| Files > 1,000 lines | 56 (8.6%) | **CRITICAL** |
| Files > 2,000 lines | 10 (1.5%) | **CRITICAL** |
| `any` type occurrences | ~141 across 40+ files | **HIGH** |
| `as any` unsafe casts | ~90 across 40+ files | **HIGH** |
| Silent empty catch blocks | 10 across 5 files | MEDIUM |
| TODO/FIXME/HACK markers | 86 across 22 files | MEDIUM |
| `console.log` in production code | 947 across 20 files | HIGH |
| Barrel index.ts files > 500 lines | 14 files | HIGH |

---

## 1. Cyclomatic Complexity -- Highest Complexity Files

The following files contain numerous branching paths (switch/case, if/else chains, try/catch, ternary operators) that drive cyclomatic complexity well beyond recommended thresholds.

### Critical (Estimated Cyclomatic > 50)

| File | Lines | Est. Cyclomatic | Severity |
|------|-------|-----------------|----------|
| `cli/src/commands/hooks.ts` | 5,237 | >100 | **CRITICAL** |
| `cli/src/mcp-tools/hooks-tools.ts` | 3,843 | >80 | **CRITICAL** |
| `guidance/src/analyzer.ts` | 3,194 | >70 | **CRITICAL** |
| `plugins/src/integrations/ruvector/gnn.ts` | 3,050 | >60 | **CRITICAL** |
| `cli/src/memory/memory-initializer.ts` | 2,752 | >60 | **CRITICAL** |

### High (Estimated Cyclomatic 30-50)

| File | Lines | Est. Cyclomatic | Severity |
|------|-------|-----------------|----------|
| `cli/src/commands/analyze.ts` | 2,343 | ~45 | HIGH |
| `hooks/src/workers/index.ts` | 2,075 | ~40 | HIGH |
| `swarm/src/queen-coordinator.ts` | 2,025 | ~40 | HIGH |
| `cli/src/init/executor.ts` | 1,990 | ~35 | HIGH |
| `claims/src/api/mcp-tools.ts` | 1,977 | ~35 | HIGH |
| `swarm/src/unified-coordinator.ts` | 1,844 | ~35 | HIGH |
| `cli/src/memory/memory-bridge.ts` | 1,816 | ~35 | HIGH |

**Recommendation**: Extract subcommands and handler functions into dedicated files. For example, `hooks.ts` contains 27+ subcommand definitions that should each be in their own module under `commands/hooks/`.

---

## 2. Cognitive Complexity -- Hardest Functions to Understand

Functions ranked by nesting depth, branching density, and implicit control flow.

### 2.1 `hooks-tools.ts` -- `generateSimpleEmbedding()` (lines 119-160)

- **Severity**: HIGH
- **Cognitive Score**: ~25 (triple-nested loops with trigonometric operations)
- **Issue**: Three nested for-loops with sin/cos computations, a normalization pass, and opaque magic constants (0.0137, 0.0073). No comments explain the mathematical model.
- **Recommendation**: Extract into a dedicated `SimpleEmbeddingGenerator` class in the embeddings package with documented algorithm and unit tests.

### 2.2 `hooks-tools.ts` -- Lazy loader chain (lines 24-107)

- **Severity**: HIGH
- **Cognitive Score**: ~20
- **Issue**: Six sequential lazy-loading patterns (`getRealSearchFunction`, `getRealStoreFunction`, `getSONAOptimizer`, `getEWCConsolidator`, `getMoERouter`, semantic router init) using identical nullable-singleton patterns. High cognitive load from repetition.
- **Recommendation**: Create a generic `LazyLoader<T>` utility class and replace all six occurrences.

### 2.3 `memory-bridge.ts` -- `getRegistry()` (lines 58-149)

- **Severity**: CRITICAL
- **Cognitive Score**: ~30
- **Issue**: Deeply nested async initialization with 5 levels of try/catch, suppressed console.log via monkey-patching, multiple `as any` casts, and fallback logic for controller wiring. The function conflates initialization, intelligence wiring, SkillLibrary bootstrapping, and console suppression.
- **Recommendation**: Split into `initializeRegistry()`, `wireIntelligenceControllers()`, and `wireSkillLibrary()`. Remove console monkey-patching in favor of a proper logger with log-level filtering.

### 2.4 `queen-coordinator.ts` -- `analyzeTask()` (lines 591-658)

- **Severity**: MEDIUM
- **Cognitive Score**: ~15
- **Issue**: Orchestrates 8 helper method calls sequentially. Well-structured individually but the method itself is a "method object" -- it should be an explicit pipeline or command pattern.
- **Recommendation**: Consider a `TaskAnalysisPipeline` with clearly defined stages.

### 2.5 `hooks.ts` -- `parseCoverageSummaryJson()` (lines 94-145)

- **Severity**: MEDIUM
- **Cognitive Score**: ~18
- **Issue**: Complex ternary chains with nullable chaining for coverage metric extraction (lines 106-109). A single line like `m.lines?.pct ?? m.lines?.covered != null ? ((m.lines?.covered ?? 0) / Math.max(m.lines?.total ?? 1, 1)) * 100 : 0` has operator precedence ambiguity -- `??` vs `?:` is easy to misread.
- **Recommendation**: Extract into a `safePct(metric)` helper function with explicit precedence.

---

## 3. File Size Violations

The project rule is **500 lines maximum per file**. **258 out of 649 source files (39.8%) violate this rule.**

### Top 10 Worst Offenders

| # | File | Lines | Ratio Over Limit |
|---|------|-------|-----------------|
| 1 | `cli/src/commands/hooks.ts` | 5,237 | **10.5x** |
| 2 | `cli/src/mcp-tools/hooks-tools.ts` | 3,843 | **7.7x** |
| 3 | `guidance/src/analyzer.ts` | 3,194 | **6.4x** |
| 4 | `plugins/src/integrations/ruvector/gnn.ts` | 3,050 | **6.1x** |
| 5 | `cli/src/memory/memory-initializer.ts` | 2,752 | **5.5x** |
| 6 | `plugins/src/integrations/ruvector/self-learning.ts` | 2,376 | **4.8x** |
| 7 | `cli/src/commands/analyze.ts` | 2,343 | **4.7x** |
| 8 | `hooks/src/workers/index.ts` | 2,075 | **4.2x** |
| 9 | `plugins/src/integrations/ruvector/quantization.ts` | 2,036 | **4.1x** |
| 10 | `swarm/src/queen-coordinator.ts` | 2,025 | **4.1x** |

### Violation Distribution by Package

| Package | Files > 500 Lines | Worst File |
|---------|-------------------|------------|
| `cli` | ~135 | `commands/hooks.ts` (5,237) |
| `guidance` | ~23 | `analyzer.ts` (3,194) |
| `memory` | ~17 | `agentdb-adapter.ts` (1,037) |
| `plugins` | ~13 | `ruvector/gnn.ts` (3,050) |
| `integration` | ~12 | `provider-adapter.ts` (1,168) |
| `swarm` | ~7 | `queen-coordinator.ts` (2,025) |
| `hooks` | ~6 | `workers/index.ts` (2,075) |
| `neural` | ~5 | `reasoning-bank.ts` (1,279) |

**Recommendation**: Prioritize splitting the top 10 files. For command files, adopt a `commands/<name>/index.ts` directory pattern where each subcommand is a separate module.

---

## 4. Code Smells

### 4.1 God Files (Too Many Responsibilities)

| File | Lines | Responsibilities | Severity |
|------|-------|-----------------|----------|
| `cli/src/commands/hooks.ts` | 5,237 | 27+ subcommands, coverage parsing, agent routing, gap classification, token optimization, model routing | **CRITICAL** |
| `cli/src/mcp-tools/hooks-tools.ts` | 3,843 | 38 MCP tool handlers, lazy loading for 6 modules, embedding generation, routing outcome persistence, stopword filtering | **CRITICAL** |
| `guidance/src/analyzer.ts` | 3,194 | Analysis, optimization, benchmarking, headless execution, report formatting, proof chain integration | **CRITICAL** |
| `hooks/src/workers/index.ts` | 2,075 | Worker registration, scheduling, alert system, history tracking, statusline generation, persistence, DDD pattern detection | **HIGH** |
| `cli/src/memory/memory-bridge.ts` | 1,816 | Registry initialization, BM25 scoring, CRUD operations, embedding bridge, controller wiring, console monkey-patching | **HIGH** |

**Recommendation**: Apply the Single Responsibility Principle. For `hooks.ts`, extract each subcommand into `commands/hooks/pre-edit.ts`, `commands/hooks/post-edit.ts`, etc. For `analyzer.ts`, separate `AnalysisEngine`, `Optimizer`, `HeadlessBenchmark`, and `ReportFormatter` into distinct modules.

### 4.2 Long Methods (>50 lines)

Found in multiple files. Key examples:

| Function | File | Lines | Severity |
|----------|------|-------|----------|
| `pretrainCommand.action` | `hooks.ts:1037-1152` | ~115 | HIGH |
| `getRegistry()` | `memory-bridge.ts:58-149` | ~91 | HIGH |
| `routeCommand.action` | `hooks.ts:600-900+` | ~300 | **CRITICAL** |
| `workerListCommand.action` | `hooks.ts:2502-2592` | ~90 | HIGH |
| `tokenOptimizeCommand.action` | `hooks.ts:4350-4620` | ~270 | **CRITICAL** |
| `checkAlerts()` | `workers/index.ts:549-594` | ~45 | MEDIUM |
| `getStatuslineData()` | `workers/index.ts:684-724` | ~40 | MEDIUM |

### 4.3 Data Clumps (Repeated Parameter Groups)

The following parameter groups appear repeatedly across the codebase:

1. **MCP Tool Result Pattern**: Nearly every command action in `hooks.ts` follows the identical pattern: `callMCPTool<TypeLiteral>('tool_name', { ... })` with inline type literals. These response types are duplicated at each call site rather than defined as shared interfaces.
   - **Locations**: `hooks.ts` lines 298-316, 440-455, 625-642, 1075-1096, and 20+ more
   - **Severity**: HIGH
   - **Recommendation**: Define shared response interfaces in `types.ts` or a `hooks/types.ts` module.

2. **Spinner/Error Pattern**: Every command action creates a spinner, wraps in try/catch with `MCPClientError` check, and produces identical error handling. This pattern repeats 27+ times in `hooks.ts` alone.
   - **Severity**: HIGH
   - **Recommendation**: Create a `withSpinnerAndMCP<T>(toolName, params, renderFn)` utility.

3. **Coverage Metric Tuple**: `{ lines, branches, functions, statements }` appears in `CoverageFileEntry`, `parseLcovInfo`, `parseCoverageSummaryJson`, and related functions.
   - **Severity**: MEDIUM
   - **Recommendation**: Define a `CoverageMetrics` type used consistently.

### 4.4 Feature Envy

| Location | Accessing | Severity |
|----------|-----------|----------|
| `cli/src/infrastructure/in-memory-repositories.ts` | Imports directly from `swarm/src/domain/entities/agent.js` and `task.js` via `../../../swarm/src/domain/` paths | **HIGH** |
| `memory-bridge.ts` lines 106-132 | Reaches into `registry` internals via `(registry as any)._controllers` and `typeof reg.set` checks | **HIGH** |
| `hooks-tools.ts` lines 690-724 | `getStatuslineData()` directly reads and casts worker results from 5 different worker modules | MEDIUM |

### 4.5 Dead Code / Unused Patterns

- **86 TODO/FIXME/HACK markers** across 22 files indicate unfinished or temporary code.
- `codex/src/templates/index.ts` has 6 TODO markers (highest single-file count).
- `cli/src/commands/workflow.ts` has 8 TODO markers.
- `cli/src/commands/ruvector/setup.ts` has 9 TODO markers.

### 4.6 Console.log in Production Code

- **947 `console.log()` calls** across 20 production source files. Worst offenders:
  - `codex/src/cli.ts`: 121 calls
  - `plugins/examples/ruvector/self-learning.ts`: 123 calls
  - `plugins/examples/ruvector/attention-patterns.ts`: 80 calls
  - `neural/examples/sona-usage.ts`: 51 calls
  - While example files are acceptable, `codex/src/cli.ts` is production code.
- **Recommendation**: Replace with a structured logger (`ILogger` interface already exists in `mcp/src/types.ts`).

### 4.7 Silent Empty Catch Blocks

10 empty catch blocks found in 5 files:

| File | Count | Severity |
|------|-------|----------|
| `guidance/src/analyzer.ts` | 2 | MEDIUM |
| `memory/src/rvf-backend.ts` | 1 | MEDIUM |
| `cli/src/init/executor.ts` | 2 | MEDIUM |
| `shared/src/services/v3-progress.service.ts` | 2 | MEDIUM |
| `guidance/tests/analyzer.test.ts` | 3 | LOW |

**Recommendation**: At minimum, log a warning or re-throw. Silent catches hide bugs.

---

## 5. DDD Compliance Assessment

### 5.1 Bounded Context Separation

The package structure generally follows DDD bounded contexts:

| Bounded Context | Package(s) | Status |
|-----------------|-----------|--------|
| CLI / Presentation | `cli` | Mostly clean |
| Guidance / Governance | `guidance` | Well-separated |
| Memory / Persistence | `memory` | Good domain model |
| Swarm / Coordination | `swarm` | Good interfaces |
| Security | `security` | Excellent -- Zod schemas, allowlists, path validation |
| Neural / Intelligence | `neural` | Good separation |
| Claims / Authorization | `claims` | Excellent DDD -- domain events, aggregates |
| Hooks / Workers | `hooks` | Acceptable |
| Integration | `integration` | Adapter pattern used correctly |
| MCP / Protocol | `mcp` | Clean interface-driven design |

### 5.2 Boundary Violations

| Violation | Location | Severity |
|-----------|----------|----------|
| CLI directly imports swarm domain entities | `cli/src/infrastructure/in-memory-repositories.ts` lines 9-20 imports from `../../../swarm/src/domain/entities/` and `../../../swarm/src/domain/repositories/` | **HIGH** |
| Memory bridge uses `as any` to bypass controller registry API | `cli/src/memory/memory-bridge.ts` lines 82, 106, 111, 118, 127-131 | **HIGH** |
| ReasoningBank uses untyped `any` for AgentDB | `neural/src/reasoning-bank.ts` lines 33, 40-41, 175-176: `let AgentDB: any` and `private agentdb: any` | HIGH |
| Controller registry uses `any` for AgentDB | `memory/src/controller-registry.ts` line 210: `private agentdb: any = null` and 22 total `: any` uses | HIGH |

**Recommendation**: 
1. The CLI should import swarm types through the `@claude-flow/swarm` package entry point, not via relative paths into domain internals.
2. Define a typed `IControllerRegistry` interface that `memory-bridge.ts` programs against, eliminating `as any` casts.
3. Create an `IAgentDB` interface for the AgentDB dependency to eliminate untyped `any` references.

### 5.3 Positive DDD Patterns

The codebase shows several well-implemented DDD patterns:

- **Claims package**: Uses domain events (`ClaimGranted`, `ClaimRevoked`), aggregates, and proper event sourcing.
- **Memory package**: Clean domain/application/infrastructure layering with `store-memory.command.ts`, `search-memory.query.ts`, `memory-application-service.ts`.
- **Security package**: Zod-based input validation with reusable schemas, proper domain isolation.
- **Controller Registry**: Level-based initialization with parallel-within-level and graceful degradation is well-designed.
- **Worker system**: Pre-compiled regex patterns, file caching with TTL, ring-buffer for alerts/history -- good performance-conscious design.

---

## 6. Type Safety Assessment

### 6.1 `any` Type Usage

| Category | Count | Files | Severity |
|----------|-------|-------|----------|
| Explicit `: any` annotations | ~141 | 40 files | HIGH |
| Unsafe `as any` casts | ~90 | 40 files | HIGH |
| `Record<string, any>` | 2 | 2 files | MEDIUM |

**Worst Files for `any` Usage**:

| File | `: any` Count | `as any` Count |
|------|---------------|----------------|
| `memory/src/controller-registry.ts` | 22 | -- |
| `memory/src/learning-bridge.ts` | 2 | -- |
| `cli/src/memory/memory-bridge.ts` | -- | 27 |
| `memory/src/agentdb-backend.ts` | 7 | -- |
| `integration/src/agentic-flow-bridge.ts` | 1 | 7 |
| `cli/src/memory/memory-initializer.ts` | 2 | 7 |
| `memory/src/sqljs-backend.ts` | 4 | -- |
| `neural/src/reasoning-bank.ts` | 4 | -- |
| `cli/src/mcp-tools/hooks-tools.ts` | -- | 3 |

**Root Cause**: Most `any` usage stems from dynamic imports of optional dependencies (AgentDB, agentic-flow, sql.js) that lack proper type declarations.

**Recommendation**:
1. Create adapter interfaces (`IAgentDB`, `ISqlJsDatabase`) that define the expected API surface.
2. Use generic lazy loaders: `LazyLoader<IAgentDB>` instead of `let agentdb: any`.
3. Where third-party types are unavailable, create minimal `.d.ts` declaration files.

### 6.2 Missing Return Types

Most public APIs have explicit return types. The primary exceptions are:
- Inline arrow functions in command `action` handlers (inferred as `Promise<CommandResult>` from context).
- Some internal helper functions in `hooks-tools.ts` and `memory-initializer.ts`.

### 6.3 Positive Type Safety Patterns

- **Security package**: Exemplary use of Zod schemas (`InputValidator`, `PathValidator`) with compile-time type inference.
- **MCP server**: Full interface-driven design (`IMCPServer`, `ITransport`, `ToolContext`).
- **Queen Coordinator**: Rich type hierarchy (`TaskAnalysis`, `DelegationPlan`, `AgentScore`, `HealthReport`) with no `any` usage.
- **Claims domain**: Proper domain types with discriminated unions and branded types.

---

## 7. Refactoring Recommendations -- Priority Ranked

### Priority 1: CRITICAL (Immediate Action)

| # | Target | Action | Impact |
|---|--------|--------|--------|
| R1 | `cli/src/commands/hooks.ts` (5,237 lines) | Split into `commands/hooks/` directory with one file per subcommand (27 files) | Reduces max file from 5,237 to ~200 lines each; eliminates highest-complexity hotspot |
| R2 | `cli/src/mcp-tools/hooks-tools.ts` (3,843 lines) | Split MCP tool handlers into per-domain modules (`hooks-mcp-tools.ts`, `worker-mcp-tools.ts`, `coverage-mcp-tools.ts`) | Reduces from 3,843 to ~500 each |
| R3 | `guidance/src/analyzer.ts` (3,194 lines) | Extract `HeadlessBenchmark`, `Optimizer`, `ReportFormatter` into separate modules | Reduces from 3,194 to ~800 for core analyzer |
| R4 | CLI-to-Swarm boundary violation | Replace relative imports in `in-memory-repositories.ts` with package imports from `@claude-flow/swarm` | Restores DDD bounded context integrity |

### Priority 2: HIGH (Next Sprint)

| # | Target | Action | Impact |
|---|--------|--------|--------|
| R5 | Repeated spinner/MCP error pattern | Create `withMCPCommand<T>()` utility wrapping spinner, callMCPTool, error handling | Eliminates ~27 instances of duplicated boilerplate |
| R6 | `memory-bridge.ts` `as any` casts | Define `IControllerRegistry` interface; program against interface | Removes 27 unsafe casts, improves testability |
| R7 | Lazy loader duplication in `hooks-tools.ts` | Create generic `LazyLoader<T>` class | Replaces 6 identical nullable-singleton patterns |
| R8 | 14 barrel `index.ts` files > 500 lines | Split into focused sub-modules; barrel file should only re-export | Reduces accidental complexity |
| R9 | `workers/index.ts` (2,075 lines) | Extract `AlertSystem`, `HistoryTracker`, `StatuslineGenerator`, `WorkerPersistence` | Reduces from 2,075 to ~400 core |

### Priority 3: MEDIUM (Backlog)

| # | Target | Action | Impact |
|---|--------|--------|--------|
| R10 | 947 `console.log` in production | Replace with `ILogger` (already defined in `mcp/src/types.ts`) | Consistent logging, configurable levels |
| R11 | 86 TODO/FIXME markers | Triage: convert to issues or implement | Reduces technical debt |
| R12 | 10 empty catch blocks | Add logging or rethrow | Prevents silent failures |
| R13 | Inline MCP response types | Extract to shared type definitions | Improves maintainability |
| R14 | `queen-coordinator.ts` method chain | Consider pipeline/chain-of-responsibility pattern for `analyzeTask` | Improves extensibility |

---

## 8. Testability Assessment

| Factor | Score | Notes |
|--------|-------|-------|
| Dependency Injection | 7/10 | Queen Coordinator and MCP Server use constructor injection. Memory bridge uses module-level singletons. |
| Interface Usage | 7/10 | Good interfaces for MCP, Swarm, Security. Memory/AgentDB integration lacks typed interfaces. |
| Side Effect Isolation | 5/10 | `memory-bridge.ts` monkey-patches `console.log`. `hooks-tools.ts` uses module-level mutable state for lazy loaders. |
| Pure Functions | 6/10 | `bm25Score()`, `classifyCoverageGap()`, `parseLcovInfo()` are properly pure. Many action handlers mix I/O with logic. |
| Mocking Difficulty | 5/10 | Dynamic `import()` calls for optional dependencies make mocking difficult. The 6 lazy loaders in `hooks-tools.ts` require module-level mocking. |

**Overall Testability**: 6/10 (MODERATE)

---

## 9. Architecture Health Summary

### Strengths
1. **Well-defined package boundaries** for 21 packages with clear responsibilities.
2. **Strong security practices** -- Zod validation, path traversal prevention, command allowlists, CVE remediation.
3. **Good DDD patterns** in Claims, Memory, and Swarm packages with domain events, aggregates, and CQRS.
4. **Performance-conscious design** -- ring buffers for alerts/history, file caching with TTL, pre-compiled regexes, level-based parallel initialization.
5. **Graceful degradation** -- ControllerRegistry handles per-controller failures without cascading; optional dependencies fail cleanly.

### Weaknesses
1. **Massive file sizes** -- 39.8% of files violate the project's own 500-line rule.
2. **CLI package is a monolith** -- Contains 135+ files over 500 lines; commands are monolithic.
3. **Type safety gaps** -- `any` usage concentrated in memory and integration layers.
4. **DDD boundary leak** -- CLI directly imports swarm domain internals via relative paths.
5. **Excessive code duplication** -- 27+ instances of the same spinner/MCP/error pattern in hooks commands.

### Risk Assessment

| Risk | Probability | Impact | Score |
|------|------------|--------|-------|
| Bug introduced in `hooks.ts` (5,237 lines) due to merge conflict | HIGH | HIGH | 0.9 |
| Silent failure from empty catch blocks | MEDIUM | MEDIUM | 0.5 |
| Type error from `as any` casts in memory-bridge | MEDIUM | HIGH | 0.7 |
| DDD boundary erosion as CLI grows | HIGH | MEDIUM | 0.7 |
| Regression in coverage parsing (untested complex ternaries) | MEDIUM | MEDIUM | 0.5 |

---

## Appendix A: Full File Size Violation List (Top 60)

| # | File (relative to `v3/@claude-flow/`) | Lines |
|---|----------------------------------------|-------|
| 1 | `cli/src/commands/hooks.ts` | 5,237 |
| 2 | `cli/src/mcp-tools/hooks-tools.ts` | 3,843 |
| 3 | `guidance/src/analyzer.ts` | 3,194 |
| 4 | `plugins/src/integrations/ruvector/gnn.ts` | 3,050 |
| 5 | `cli/src/memory/memory-initializer.ts` | 2,752 |
| 6 | `plugins/src/integrations/ruvector/self-learning.ts` | 2,376 |
| 7 | `cli/src/commands/analyze.ts` | 2,343 |
| 8 | `hooks/src/workers/index.ts` | 2,075 |
| 9 | `plugins/src/integrations/ruvector/quantization.ts` | 2,036 |
| 10 | `swarm/src/queen-coordinator.ts` | 2,025 |
| 11 | `plugins/src/integrations/ruvector/ruvector-bridge.ts` | 2,000 |
| 12 | `cli/src/init/executor.ts` | 1,990 |
| 13 | `claims/src/api/mcp-tools.ts` | 1,977 |
| 14 | `plugins/src/integrations/ruvector/hyperbolic.ts` | 1,948 |
| 15 | `plugins/src/integrations/ruvector/types.ts` | 1,945 |
| 16 | `swarm/src/unified-coordinator.ts` | 1,844 |
| 17 | `cli/src/memory/memory-bridge.ts` | 1,816 |
| 18 | `cli/src/commands/embeddings.ts` | 1,744 |
| 19 | `cli/src/commands/neural.ts` | 1,741 |
| 20 | `plugins/src/integrations/ruvector/streaming.ts` | 1,737 |
| 21 | `cli/src/commands/memory.ts` | 1,506 |
| 22 | `claims/src/api/cli-commands.ts` | 1,459 |
| 23 | `cli/src/commands/hive-mind.ts` | 1,397 |
| 24 | `cli/src/services/headless-worker-executor.ts` | 1,362 |
| 25 | `cli/src/memory/intelligence.ts` | 1,347 |
| 26 | `neural/src/reasoning-bank.ts` | 1,279 |
| 27 | `cli/src/ruvector/graph-analyzer.ts` | 1,240 |
| 28 | `browser/src/mcp-tools/browser-tools.ts` | 1,210 |
| 29 | `cli/src/plugins/store/discovery.ts` | 1,206 |
| 30 | `cli/src/init/helpers-generator.ts` | 1,199 |
| 31 | `integration/src/provider-adapter.ts` | 1,168 |
| 32 | `embeddings/src/embedding-service.ts` | 1,157 |
| 33 | `cli/src/services/worker-daemon.ts` | 1,149 |
| 34 | `guidance/src/manifest-validator.ts` | 1,139 |
| 35 | `mcp/src/server.ts` | 1,134 |
| 36 | `cli/src/services/claim-service.ts` | 1,117 |
| 37 | `integration/src/swarm-adapter.ts` | 1,112 |
| 38 | `cli/src/commands/init.ts` | 1,109 |
| 39 | `hooks/src/reasoningbank/index.ts` | 1,090 |
| 40 | `codex/src/validators/index.ts` | 1,089 |
| 41 | `integration/src/multi-model-router.ts` | 1,079 |
| 42 | `swarm/src/workers/worker-dispatch.ts` | 1,076 |
| 43 | `testing/src/v2-compat/compatibility-validator.ts` | 1,072 |
| 44 | `cli/src/commands/agent.ts` | 1,068 |
| 45 | `plugins/src/integrations/ruvector/attention.ts` | 1,063 |
| 46 | `guidance/src/ruvbot-integration.ts` | 1,045 |
| 47 | `plugins/src/integrations/ruvector/attention-advanced.ts` | 1,040 |
| 48 | `plugins/src/collections/official/index.ts` | 1,040 |
| 49 | `memory/src/agentdb-adapter.ts` | 1,037 |
| 50 | `memory/src/agentdb-backend.ts` | 1,031 |
| 51 | `testing/src/fixtures/mcp-fixtures.ts` | 1,030 |
| 52 | `memory/src/controller-registry.ts` | 1,029 |
| 53 | `codex/src/migrations/index.ts` | 1,026 |
| 54 | `codex/src/generators/config-toml.ts` | 1,016 |
| 55 | `memory/src/hnsw-index.ts` | 1,013 |
| 56 | `cli/src/mcp-tools/hive-mind-tools.ts` | 1,012 |

---

## Appendix B: Methodology

- **File analysis**: All 649 `.ts` source files (excluding `.d.ts`, `.test.ts`, `.spec.ts`, `node_modules/`, `dist/`) were measured for line count, export count, and import depth.
- **Type safety**: `any`, `as any`, and `Record<string, any>` patterns were counted via regex search.
- **Code smells**: Identified through manual inspection of the 20 largest files across 8 packages, supplemented by pattern-based searches for known anti-patterns.
- **Complexity estimation**: Cyclomatic complexity was estimated based on file size, branching density (if/else, switch/case, ternary, try/catch), and nesting depth observed during manual review. Exact metrics would require a TypeScript AST-based analyzer.
- **DDD compliance**: Evaluated by examining import graphs, package boundaries, and domain model patterns.

---

*Report generated by QE Code Complexity Analyzer v3 -- 2026-04-08*
