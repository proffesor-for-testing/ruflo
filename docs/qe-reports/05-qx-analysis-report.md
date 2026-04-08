# QX Analysis Report: Ruflo v3.5 Quality Experience Assessment

**Report Date**: 2026-04-08
**Analyst**: QX Partner (Agentic QE v3)
**Scope**: CLI commands, MCP API surface, configuration, error handling, onboarding, documentation
**Files Analyzed**: 18 primary source files across CLI commands, MCP tools, output formatting, error handling, security, and init subsystems

---

## Executive Summary

Ruflo v3.5 is a mature, feature-rich AI orchestration platform with **40+ CLI commands**, **314 MCP tools**, and **60+ agent types**. The codebase demonstrates strong engineering discipline in several areas -- particularly in error handling infrastructure, configuration defaults, and the diagnostic system. However, the sheer breadth of the surface area creates significant cognitive load for new users, and several quality-experience gaps exist between the infrastructure capabilities and the user-facing polish.

**Overall QX Score: 68/100 (C+)**

| Dimension | Score | Grade |
|-----------|-------|-------|
| CLI User Experience | 3.5/5 | B- |
| Error Handling UX | 3.0/5 | C+ |
| API Ergonomics | 4.0/5 | B |
| Configuration Complexity | 3.5/5 | B- |
| Onboarding Flow | 4.0/5 | B |
| Documentation Quality | 2.0/5 | D |
| Cognitive Load | 2.5/5 | D+ |
| Failure Recovery | 3.5/5 | B- |
| Consistency | 3.5/5 | B- |
| Accessibility of Features | 3.0/5 | C+ |

---

## 1. CLI User Experience (3.5/5)

### Strengths

**Well-structured command hierarchy.** The `index.ts` command registry organizes 40+ commands into five clear categories: `primary`, `advanced`, `utility`, `analysis`, and `management`. This is sound information architecture. The `commandsByCategory` export enables categorized help display, which is the right approach for a large command set.

**Rich interactive prompts.** Commands like `init wizard`, `agent spawn`, and `task create` fall back to interactive selection menus when required flags are missing and `ctx.interactive` is true. For example, the agent spawn command presents a curated list of 15 agent types with descriptive hints:

```typescript
{ value: 'coder', label: 'Coder', hint: 'Code development with neural patterns' }
```

This "progressive disclosure via interaction" pattern is well-executed.

**Command examples are comprehensive.** Nearly all commands include `examples` arrays with realistic usage patterns. The grep found 217 example definitions across 46 command files. The doctor command alone provides 5 examples covering common use cases.

**Aliases support discoverability.** The task create command supports aliases `['new', 'add']`, reducing the need to memorize exact verbs.

### Weaknesses

**Help text is implicitly generated, not explicit.** When a parent command is invoked without a subcommand (e.g., `claude-flow config`), the help is hand-built inline rather than auto-generated from the registered subcommand metadata. The config command's action handler manually lists subcommands with `output.printList()`. This means help text can drift from the actual subcommand set.

**No short descriptions in top-level help.** The `commands` array exported from `index.ts` contains the full command objects, but there is no evidence of a formatted top-level `--help` output that groups commands by category with one-line descriptions. The categorization exists in data but may not surface consistently in the user-visible help.

**Flag conflicts are not always obvious.** The memory store command notes that `--value` has no short flag because `-v` is reserved for verbose globally, but this reservation is not documented in the option definition. Users may attempt `-v` and get unexpected behavior.

### Oracle Problem Detected

**User Mental Model vs. System Model**: Users expect a flat, simple CLI (like `git`), but Ruflo has a deep command-subcommand hierarchy (e.g., `hooks worker dispatch --trigger audit`). The system model exposes implementation details (hooks, workers, triggers) that require understanding the internal architecture. This is a user-vs-system oracle conflict.

---

## 2. Error Handling UX (3.0/5)

### Strengths

**Consistent error output formatting.** The `OutputFormatter` class provides standardized error display via `printError()`, which uses a red `[ERROR]` prefix and writes to stderr. There are 580 error/printError invocations across the 44 command files, indicating thorough error handling coverage.

**Structured error classification.** The production `error-handler.ts` module classifies errors into 10 categories (validation, authentication, authorization, not_found, rate_limit, timeout, circuit_open, external_service, internal, unknown) using regex pattern matching. Each category carries a `retryable` flag and optional `retryAfterMs`. This is enterprise-grade error infrastructure.

**Doctor command provides actionable fixes.** Each health check returns a `fix` string when the status is `warn` or `fail`. For example:

```typescript
{ name: 'npm Version', status: 'warn', message: 'v8 (>= 9 recommended)', fix: 'npm install -g npm@latest' }
```

The `--fix` flag reveals all fixes, and `--install` auto-installs missing dependencies. This is a model for actionable diagnostics.

### Weaknesses

**Most CLI error messages lack actionability.** Outside of `doctor`, error messages are typically just the raw error text wrapped in `printError()`. For example in `config.ts`:

```typescript
output.printError(message);
return { success: false, exitCode: 1 };
```

There is no suggestion for what the user should do next. The production error handler's structured errors with `retryable` hints exist but are not surfaced in CLI output.

**Silent catch blocks proliferate.** The swarm status function `getSwarmStatus()` has 8 empty catch blocks (`catch { // Ignore }`) that silently swallow filesystem errors. While individually defensible for non-critical metrics, the pattern means users get no feedback when state files are corrupted.

**MCP client errors lose context.** The `MCPClientError` wraps the original error but flattens it to a string:

```typescript
`Failed to execute MCP tool '${toolName}': ${error.message}`
```

The original error's category, retryability, and structured details are lost before reaching the user.

### Rule of Three Failure Modes

1. **Silent failure**: Empty catch blocks mean corrupted state goes undetected until a downstream command fails with an unrelated error.
2. **Non-actionable errors**: Users see "Failed to store" but not why or how to fix it.
3. **Error chain loss**: MCP tool errors lose their structured classification when re-thrown through the CLI layer.

---

## 3. API Ergonomics (4.0/5)

### Strengths

**Zod schemas provide self-documenting validation.** Every MCP tool input is defined with Zod schemas that include `.describe()` annotations. The memory search schema is exemplary:

```typescript
query: z.string().min(1).describe('Search query (semantic or keyword)'),
searchType: z.enum(['semantic', 'keyword', 'hybrid']).default('hybrid'),
limit: z.number().int().positive().max(1000).default(10),
```

This provides type safety, documentation, sensible defaults, and validation in one declaration.

**Consistent tool structure.** All MCP tools follow an identical pattern: Zod input schema, TypeScript interface for output, handler function. The `MCPTool` type enforces this contract. The tool index file (`v3/mcp/tools/index.ts`) provides a clean central registry.

**Agent type validation is security-conscious.** The agent tools module defines `ALLOWED_AGENT_TYPES` as a const array of 40+ valid types and validates input against it with a fallback regex for custom types. This prevents arbitrary type injection while remaining extensible.

**Pagination and filtering are standard.** List operations consistently offer `limit`, `offset`, `sortBy`, and `sortOrder` parameters. Search operations support `minRelevance` thresholds.

### Weaknesses

**MCP tool naming is inconsistent.** CLI commands use kebab-case (`agent spawn`), but MCP tool names use mixed conventions: `agent_spawn` (underscore), `memory/store` (slash). The `v2-compat-tools.ts` layer adds another naming convention for backward compatibility. Users must remember which convention applies in which context.

**Return type interfaces are not shared.** Each tool file defines its own `AgentInfo`, `Memory`, `SearchResult` interfaces locally. These are not exported from a shared types package, making it harder for consumers to build typed integrations.

---

## 4. Configuration Complexity (3.5/5)

### Strengths

**Defaults-first design is implemented.** The config system searches for config files in a prioritized cascade (`.claude-flow/config.json`, `claude-flow.config.json`, `.claude-flow.json`, then YAML variants) and falls back to sensible defaults. The doctor command's config check explicitly notes "No config file (using defaults)" as a warning, not an error.

**Configuration is dot-notation accessible.** The `config get` and `config set` commands support dot-notation paths (`swarm.topology`, `memory.backend`) with automatic nested object traversal. The `get` command without arguments flattens and displays all configuration in a table.

**Import/export for portability.** The config command supports `import` and `export` subcommands, and the reset command supports per-section resets (`--section swarm`).

### Weaknesses

**Six possible config file locations.** Between JSON (3 paths) and YAML (3 paths), plus environment variables, the config discovery path is complex. A user who creates `claude-flow.config.json` may not realize their `.claude-flow/config.yaml` is being loaded instead.

**V3Config interface is sprawling.** The type definition in `types.ts` spans at least 6 nested interfaces (`AgentConfig`, `SwarmConfig`, `MemoryConfig`, `MCPConfig`, `CLIPreferences`, `HooksConfig`), each with multiple fields. There is no "minimal required config" type.

**The start command re-implements YAML parsing.** A hand-rolled YAML parser (`parseSimpleYaml`) in `start.ts` handles only basic key-value pairs. Complex YAML features (arrays, multiline strings) will silently produce incorrect results. This is a hidden footgun for users editing config files.

### Oracle Problem Detected

**Configuration Format Conflict**: The system supports both JSON and YAML configs, but the init command generates YAML while the config command reads/writes JSON via `configManager`. Users may create config in one format and have it ignored by commands that prefer the other.

---

## 5. Onboarding Flow (4.0/5)

### Strengths

**The init wizard is well-designed.** The `init wizard` subcommand walks users through preset selection (Default/Minimal/Full/Custom), component selection via multi-select, skill set selection, hooks configuration, and topology choice. Each option includes descriptive hints.

**Progressive initialization.** The `--start-all` flag chains init, memory init, daemon start, and swarm init into a single command. Without it, the "Next steps" list guides users through the sequence manually with highlighted commands:

```typescript
`Run ${output.highlight('claude-flow daemon start')} to start background workers`
```

**Re-initialization is safe.** The init command detects existing configuration, warns the user, and in interactive mode asks for confirmation before overwriting. Non-interactive mode refuses to proceed without `--force`.

**Doctor validates the full stack.** The health check covers 14 components (Node version, npm, git, config, daemon, memory, API keys, MCP servers, disk space, TypeScript, Claude Code CLI, version freshness, agentic-flow). The parallel execution optimization is well-documented in the code.

### Weaknesses

**No "quick start" one-liner.** Getting from zero to running requires at minimum `init` then `start` then understanding the swarm topology, memory backend, and agent types. There is no `ruflo quickstart` that sets everything up with defaults and spawns a basic agent.

**Post-init guidance is command-oriented, not goal-oriented.** The "Next steps" list tells users which commands to run but not what those commands achieve or why they matter. A user who does not know what a "daemon" or "swarm" is gets no explanation.

**Embedding initialization is a separate opt-in step.** The `--with-embeddings` flag on init starts the ONNX embedding subsystem, but then tells the user to run another command (`embeddings init --download`) to actually download the model. This is a two-step process that could be one.

---

## 6. Documentation Quality (2.0/5)

### Strengths

**Zod schemas serve as inline documentation.** The MCP tool input schemas with `.describe()` annotations provide parameter-level documentation that is always in sync with the code.

**Module-level JSDoc headers exist.** All examined files have module-level doc comments describing their purpose. The security module (`input-validator.ts`) includes `@module` tags and security property descriptions.

### Weaknesses

**Zero JSDoc on command action functions.** A grep for `@param|@returns|@throws|@example` across the 46 command files returned **0 results**. None of the command handlers, subcommand actions, or utility functions have parameter or return type documentation. This is the most significant documentation gap.

**Public API functions lack JSDoc.** The `OutputFormatter` class methods (`printTable`, `printBox`, `printList`, `createSpinner`) have no JSDoc explaining their parameters or behavior. The `callMCPTool` function in `mcp-client.ts` is an exception -- it has JSDoc with `@param`, `@returns`, `@throws`, and `@example`.

**Internal helper functions are undocumented.** Functions like `getSwarmStatus()`, `updateSwarmActivityMetrics()`, `parseSimpleYaml()`, and `isInitialized()` have no documentation explaining their behavior, edge cases, or assumptions.

**No architecture documentation for the CLI layer.** The relationship between CLI commands, MCP client, MCP tools, and the init subsystem is not documented anywhere in the source. New contributors must trace imports manually.

### Rule of Three Failure Modes

1. **New contributor confusion**: Without JSDoc, understanding parameter expectations requires reading the full function body.
2. **Integration errors**: Consumers of the MCP tool APIs cannot discover the expected input/output shapes without reading Zod schemas.
3. **Maintenance drift**: Undocumented helper functions accumulate implicit assumptions that break during refactoring.

---

## 7. Cognitive Load (2.5/5)

### Strengths

**Command categorization helps.** The five-category grouping (primary, advanced, utility, analysis, management) provides a mental model for navigation.

**Interactive fallbacks reduce memorization.** When flags are omitted, interactive prompts guide users through available options with hints.

### Weaknesses

**The surface area is enormous.** Users must navigate 40+ top-level commands, 140+ subcommands, 314 MCP tools, 60+ agent types, 27 hooks, and 12 background workers. The `CLAUDE.md` configuration file alone is over 500 lines of operational instructions.

**Terminology overload.** Users encounter: swarm, hive-mind, daemon, hooks, workers, agents, sessions, tasks, neural patterns, embeddings, SONA, MoE, HNSW, EWC++, CRDT, Byzantine consensus, Raft, gossip protocol, SPARC methodology, and more. These terms come from different domains (distributed systems, ML, software methodology) with no glossary.

**Multiple overlapping concepts.** The distinction between "swarm" and "hive-mind" is not clear from command names alone. Both involve multi-agent coordination. Similarly, "hooks" and "workers" both run in the background but serve different purposes that are not obvious from their names.

**No progressive disclosure in the tool surface.** All 314 MCP tools are registered in a flat namespace. There is no tiered access pattern where beginners see 10 essential tools and experts discover the rest.

### Oracle Problem Detected

**Expert User vs. Novice User Conflict**: The platform is designed for power users who understand distributed systems concepts, but the marketing and onboarding target a broader audience. The init wizard makes setup easy, but immediately after, users face the full complexity of the system.

---

## 8. Failure Recovery (3.5/5)

### Strengths

**Production-grade retry infrastructure.** The `retry.ts` module provides configurable retry with 4 strategies (exponential, linear, constant, fibonacci), jitter, per-error-type non-retryable lists, and detailed retry history tracking. The `RetryResult` type captures attempts, total time, and per-attempt error history.

**Health check self-healing.** The doctor command's `--install` flag auto-installs missing Claude Code CLI. The `--fix` flag provides copy-pasteable fix commands for every detected issue.

**Graceful degradation patterns.** The doctor checks use `Promise.allSettled()` so one failing check does not prevent others from completing. The version freshness check handles npm registry unreachability gracefully.

**Daemon recovery.** The daemon status check detects stale PID files and suggests cleanup commands.

### Weaknesses

**Retry infrastructure is not surfaced in CLI commands.** The `retry.ts` module is in `production/` but no CLI command appears to use it for user-facing operations. MCP tool calls in `callMCPTool` do not retry on transient failures.

**No automatic state recovery.** If the swarm state file (`.swarm/state.json`) becomes corrupted, there is no `swarm repair` or automatic recovery. The silent catch blocks in `getSwarmStatus()` mask the problem.

**Task failure recovery is limited.** The task command supports retry logic (`retry` option, `retryCount`, `retryDelay`), but there is no task restart or resume mechanism for partially completed multi-step tasks.

---

## 9. Consistency (3.5/5)

### Strengths

**Uniform command structure.** Every command implements the `Command` interface with `name`, `description`, `options`, `examples`, and `action`. The `CommandOption` type enforces consistent option definitions with `name`, `short`, `description`, `type`, `default`, `required`, and `choices`.

**Consistent output formatting.** All commands use the shared `output` singleton from `output.ts`. Status displays use consistent color coding: green for success, yellow for warnings, red for errors, cyan for highlights, gray for dim/secondary information.

**MCP tool pattern is uniform.** Every tool group follows the same structure: Zod schema, type definitions, handler functions, exported array.

### Weaknesses

**Flag naming is inconsistent.** Some flags use kebab-case (`--skip-claude`, `--start-all`), while others use camelCase (`--startAll`, `--startDaemon`). The init command handles both variants via fallback:

```typescript
const startAll = ctx.flags['start-all'] || ctx.flags.startAll;
```

This suggests the flag parser's behavior is ambiguous and commands must handle both.

**Return value structures vary.** Some commands return `{ success: true, data: result }`, others return `{ success: true }` without data, and some return `{ success: true, message: 'text' }`. The `CommandResult` type allows all of these, but there is no standard for which fields should be populated.

**Error message formatting varies.** Some commands use `output.printError('message')`, others use `output.error('text')` (which is a color function, not a print function). Some error paths include recovery hints, most do not.

---

## 10. Accessibility of Features (3.0/5)

### Strengths

**Shell completions for 4 shells.** The `completions` command generates completion scripts for bash, zsh, fish, and powershell, covering top-level commands and subcommands.

**NO_COLOR and FORCE_COLOR support.** The `OutputFormatter` respects the `NO_COLOR` environment variable standard and `FORCE_COLOR` for CI environments.

**Verbosity levels.** The output system supports 4 verbosity levels (quiet, normal, verbose, debug) with appropriate suppression at each level. Quiet mode only shows errors and direct results.

### Weaknesses

**Advanced features are buried.** The hooks system (27 types, 12 workers), neural patterns, embeddings, and coverage routing are powerful but require deep knowledge to discover and use. There is no `claude-flow explore` or `claude-flow features` command that helps users discover capabilities.

**The 80/20 principle is not applied.** The top 5-10 commands that 80% of users need (init, start, agent spawn, task create, memory store/search, status, doctor) are mixed in with 30+ specialized commands. The `commandsByCategory.primary` array is a step in the right direction but includes 10 commands, some of which (like `mcp` and `hooks`) are not beginner-essential.

**No guided workflows.** There is no `claude-flow tutorial` or step-by-step guided experience. The wizard handles initial setup but does not teach users how to accomplish common goals (e.g., "How do I spawn a team of agents to refactor this module?").

---

## Prioritized Recommendations

### Priority 1 -- Critical (High Impact, Low-Medium Effort)

| # | Recommendation | Effort | Impact | Area |
|---|---------------|--------|--------|------|
| 1 | Add JSDoc to all public command action functions with `@param`, `@returns`, and `@example` | Medium | High | Documentation |
| 2 | Surface structured error details in CLI output: show error category, whether it is retryable, and a suggested fix | Medium | High | Error Handling |
| 3 | Create a `ruflo quickstart` command that runs init with defaults, starts all services, and spawns a sample agent in one step | Low | High | Onboarding |
| 4 | Wire the production retry module into `callMCPTool` for transient failures | Low | High | Failure Recovery |

### Priority 2 -- Important (Medium Impact, Medium Effort)

| # | Recommendation | Effort | Impact | Area |
|---|---------------|--------|--------|------|
| 5 | Standardize flag naming to kebab-case only and remove the camelCase fallback handling | Medium | Medium | Consistency |
| 6 | Add a feature discovery command (`ruflo explore`) that lists capabilities by use case, not by technical category | Medium | Medium | Accessibility |
| 7 | Replace the hand-rolled YAML parser in `start.ts` with a proper YAML library or standardize on JSON-only config | Low | Medium | Configuration |
| 8 | Reduce the primary command set to 5-6 essential commands and move the rest to `advanced` | Low | Medium | Cognitive Load |
| 9 | Add a glossary command or `--explain` flag that defines platform-specific terminology (swarm, hive-mind, hooks, workers) | Medium | Medium | Cognitive Load |

### Priority 3 -- Enhancement (Lower Impact, Variable Effort)

| # | Recommendation | Effort | Impact | Area |
|---|---------------|--------|--------|------|
| 10 | Auto-generate help text from registered subcommand metadata instead of hand-building it in parent action handlers | Medium | Low | CLI UX |
| 11 | Export shared interface types from a `@claude-flow/types` package for MCP tool consumers | High | Medium | API Ergonomics |
| 12 | Add a `swarm repair` command that validates and recovers corrupted state files | Medium | Low | Failure Recovery |
| 13 | Replace silent catch blocks in `getSwarmStatus()` with verbose-level warnings so corruption is detectable | Low | Low | Error Handling |
| 14 | Add a `claude-flow tutorial` command with guided multi-step walkthroughs for common workflows | High | Medium | Accessibility |

---

## Oracle Problems Summary

| # | Type | Description | Severity |
|---|------|-------------|----------|
| 1 | User vs. System | Users expect a flat CLI model; system exposes deep implementation hierarchy | Medium |
| 2 | Config Format | JSON and YAML configs coexist; different commands prefer different formats | Low |
| 3 | Expert vs. Novice | Full complexity is exposed immediately after a smooth onboarding wizard | High |

---

## Heuristic Analysis Detail

### H1: Problem Understanding

| ID | Heuristic | Score | Finding |
|----|-----------|-------|---------|
| H1.1 | Understand the Problem | 72 | The CLI solves a real, complex problem (multi-agent orchestration), but the problem statement is not articulated to the user during onboarding |
| H1.2 | Identify Stakeholders | 65 | Primary user is "Claude Code power user" but secondary users (beginners, integrators, CI pipelines) receive less UX attention |
| H1.3 | Rule of Three | 70 | Error paths identify single failure modes; minimum-3 analysis not applied in user-facing diagnostics |

### H2: User Needs

| ID | Heuristic | Score | Finding |
|----|-----------|-------|---------|
| H2.1 | Ease of Use | 68 | Interactive prompts are excellent; non-interactive mode requires deep flag knowledge |
| H2.2 | Learnability | 55 | No tutorial, no glossary, no progressive skill-building path |
| H2.3 | Error Recovery | 65 | Doctor command is strong; in-command recovery is weak |
| H2.4 | Feedback Quality | 70 | Spinners, tables, and color coding are well-implemented; verbose mode adds detail |
| H2.5 | Discoverability | 60 | Shell completions help; no feature exploration or "what can I do?" guidance |

### H3: Business Needs

| ID | Heuristic | Score | Finding |
|----|-----------|-------|---------|
| H3.1 | Reliability | 75 | Production retry, circuit breaker, and health check infrastructure is solid |
| H3.2 | Security | 80 | Zod validation, agent type whitelisting, path traversal prevention, secure error logging |
| H3.3 | Extensibility | 78 | Plugin system, MCP tool registry, lazy command loading, provider abstraction |
| H3.4 | Performance | 75 | Parallel health checks, lazy loading, HNSW-indexed search, CLI startup target of less than 500ms |

### H4: Balance

| ID | Heuristic | Score | Finding |
|----|-----------|-------|---------|
| H4.1 | User-Business Alignment | 62 | Enterprise features (security, compliance) are well-built but add cognitive load for non-enterprise users |
| H4.2 | Simplicity-Power Trade-off | 55 | Power is maximized at the expense of simplicity; no "simple mode" |
| H4.3 | Consistency-Flexibility Trade-off | 68 | Uniform patterns exist but multiple configuration formats and naming conventions create friction |

### H5: Impact

| ID | Heuristic | Score | Finding |
|----|-----------|-------|---------|
| H5.1 | Visible Impact | 72 | Color-coded output, tables, spinners, and boxes provide strong visual feedback |
| H5.2 | Invisible Impact (Performance) | 75 | CLI startup is optimized; health checks run in parallel; lazy loading reduces initial parse time |
| H5.3 | Invisible Impact (Security) | 80 | Input validation at boundaries, secure error sanitization, no credential leaks |
| H5.4 | Invisible Impact (Accessibility) | 60 | NO_COLOR support exists; no screen reader testing or WCAG consideration for CLI output |

### H6: Creativity

| ID | Heuristic | Score | Finding |
|----|-----------|-------|---------|
| H6.1 | Novel Approaches | 75 | The 3-tier model routing (Agent Booster/Haiku/Opus) is innovative cost optimization |
| H6.2 | Cross-Domain Insight | 70 | Distributed systems concepts (Byzantine, Raft, CRDT) applied to AI agent coordination |
| H6.3 | Testing Innovation | 65 | Coverage-aware routing, mutation-based suggestions, but no automated UX testing |

---

## Methodology

This QX analysis was performed by reading 18 primary source files and performing targeted searches across the full CLI command surface (46 files) and MCP tool surface (26 files). Analysis focused on user-facing code paths, error handling patterns, documentation density, and API design consistency.

**Files read in full**: `doctor.ts`, `config.ts`, `index.ts` (commands), `output.ts`, `types.ts`, `start.ts`, `status.ts`, `swarm.ts`, `agent-tools.ts`, `memory-tools.ts`, `tools/index.ts`, `mcp-client.ts`, `input-validator.ts`, `retry.ts`, `error-handler.ts`, `completions.ts`

**Files read partially**: `init.ts` (3 sections, 520 lines), `memory.ts` (150 lines), `hooks.ts` (150 lines), `agent.ts` (120 lines), `task.ts` (100 lines)

**Searches performed**: JSDoc annotation density (0 results in commands), catch block count (247 across 43 files), error message count (580 across 44 files), retry references (112 across 15 files), validation references (52 across 18 files), example definitions (217 across 46 files)

**Quality Principles Applied**: QX 23-heuristic framework, Rule of Three failure analysis, Oracle problem detection, User-Business balance analysis.
