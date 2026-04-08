# Claude Code Configuration - Ruflo v3.5

> **Ruflo v3.5** (2026-04-07) — Stable release with verified capabilities.
> 6,000+ commits, 314 MCP tools, 16 agent roles + custom types, 19 AgentDB controllers.
> Packages: `@claude-flow/cli@3.5.65`, `claude-flow@3.5.65`, `ruflo@3.5.65`

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Key Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@claude-flow/cli` | `v3/@claude-flow/cli/` | CLI entry point (26 commands) |
| `@claude-flow/codex` | `v3/@claude-flow/codex/` | Dual-mode Claude + Codex collaboration |
| `@claude-flow/guidance` | `v3/@claude-flow/guidance/` | Governance control plane |
| `@claude-flow/hooks` | `v3/@claude-flow/hooks/` | 17 hooks + 12 workers |
| `@claude-flow/memory` | `v3/@claude-flow/memory/` | AgentDB + HNSW search |
| `@claude-flow/security` | `v3/@claude-flow/security/` | Input validation, CVE remediation |

## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP

**Mandatory patterns:**
- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL terminal operations in ONE Bash message
- ALWAYS batch ALL memory store/retrieve operations in ONE message

---

## Swarm Orchestration

- MUST initialize the swarm using MCP tools when starting complex tasks
- MUST spawn concurrent agents using Claude Code's Task tool
- Never use MCP tools alone for execution — Task tool agents do the actual work
- MUST call MCP tools AND Task tool in ONE message for complex work

### 3-Tier Model Routing (ADR-026)

| Tier | Handler | Use Cases |
|------|---------|-----------|
| **1** | Agent Booster (WASM, <1ms, $0) | Simple transforms (var->const, add types, etc.) — **Skip LLM entirely** |
| **2** | Haiku (~500ms, $0.0002) | Simple tasks, low complexity (<30%) |
| **3** | Sonnet/Opus (2-5s, $0.003-0.015) | Complex reasoning, architecture, security (>30%) |

- Check for `[AGENT_BOOSTER_AVAILABLE]` or `[TASK_MODEL_RECOMMENDATION]` before spawning agents
- Use Edit tool directly when `[AGENT_BOOSTER_AVAILABLE]`

### Anti-Drift Defaults

- ALWAYS use hierarchical topology, maxAgents 6-8, specialized strategy, `raft` consensus
- Run frequent checkpoints via `post-task` hooks, keep shared memory namespace

### Task Complexity Detection

**AUTO-INVOKE SWARM when:** 3+ files, new features, cross-module refactoring, API changes with tests, security, performance, DB schema changes.

**SKIP SWARM for:** Single file edits, 1-2 line fixes, doc updates, config changes, quick questions.

### Agent Routing

| Code | Task | Agents |
|------|------|--------|
| 1 | Bug Fix | coordinator, researcher, coder, tester |
| 3 | Feature | coordinator, architect, coder, tester, reviewer |
| 5 | Refactor | coordinator, architect, coder, reviewer |
| 7 | Performance | coordinator, perf-engineer, coder |
| 9 | Security | coordinator, security-architect, auditor |
| 11 | Memory | coordinator, memory-specialist, perf-engineer |
| 13 | Docs | researcher, api-docs |

## Claude Code vs MCP Tools

**Claude Code handles ALL EXECUTION:** Task tool (spawn agents), file operations, code generation, Bash, TodoWrite, git.

**MCP tools ONLY COORDINATE:** Swarm init, agent type definitions, task orchestration, memory management, neural features, performance tracking.

## Project Configuration

- **Topology**: hierarchical | **Max Agents**: 8 | **Strategy**: specialized | **Consensus**: raft
- **Memory Backend**: hybrid (SQLite + AgentDB) | **HNSW**: Enabled | **Neural**: Enabled (SONA)

---

## Detailed Reference (read when needed)

The following detailed guides are in **`docs/claude-flow-reference.md`** — read the relevant section when needed:

| Section | When to read |
|---------|-------------|
| Dual-Mode Collaboration | When spawning both Claude + Codex workers for a task |
| Swarm Protocols & Auto-Start | When implementing the full swarm protocol with code examples |
| V3 CLI Commands | When you need specific CLI command syntax or subcommands |
| Headless Background Instances | When using `claude -p` for parallel background work |
| Available Agents (60+ types) | When choosing which agent type to spawn |
| Agent Teams | When creating teams with TaskCreate/SendMessage/TeamCreate |
| V3 Hooks System | When configuring hooks or background workers |
| Intelligence System (RuVector) | When working with SONA, MoE, HNSW, or the learning pipeline |
| Embeddings / Hive-Mind / Performance | When working with vector search, consensus, or benchmarks |
| Memory Bridge | When bridging Claude Code auto-memory with AgentDB |
| Plugins (20 available) | When installing, enabling, or developing plugins |

## Operational Procedures (in CLAUDE.local.md)

| Procedure | When to read |
|-----------|-------------|
| Publishing to npm | When publishing `@claude-flow/cli`, `claude-flow`, or `ruflo` packages |
| Plugin Registry Operations | When adding plugins to the IPFS/Pinata registry |
| Environment Variables | When configuring local dev environment |
| Doctor Health Checks | When running diagnostics |
| Hooks Quick Reference | When running hook commands from terminal |

---

## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues

Remember: **Claude Flow coordinates, Claude Code creates!**

---

## Agentic QE v3

This project uses **Agentic QE v3** - a Domain-Driven Quality Engineering platform with 13 bounded contexts, ReasoningBank learning, HNSW vector search, and Agent Teams coordination (ADR-064).

---

### CRITICAL POLICIES

#### Integrity Rule (ABSOLUTE)
- NO shortcuts, fake data, or false claims
- ALWAYS implement properly, verify before claiming success
- ALWAYS use real database queries for integration tests
- ALWAYS run actual tests, not assume they pass

**We value the quality we deliver to our users.**

#### Test Execution
- NEVER run `npm test` without `--run` flag (watch mode risk)
- Use: `npm test -- --run`, `npm run test:unit`, `npm run test:integration` when available

#### Data Protection
- NEVER run `rm -f` on `.agentic-qe/` or `*.db` files without confirmation
- ALWAYS backup before database operations

#### Git Operations
- NEVER auto-commit/push without explicit user request
- ALWAYS wait for user confirmation before git operations

---

### Quick Reference

```bash
# Run tests
npm test -- --run

# Check quality
aqe quality assess

# Generate tests
aqe test generate <file>

# Coverage analysis
aqe coverage <path>
```

### Using AQE MCP Tools

AQE exposes tools via MCP with the `mcp__agentic-qe__` prefix. You MUST call `fleet_init` before any other tool.

#### 1. Initialize the Fleet (required first step)

```typescript
mcp__agentic-qe__fleet_init({
  topology: "hierarchical",
  maxAgents: 15,
  memoryBackend: "hybrid"
})
```

#### 2. Generate Tests

```typescript
mcp__agentic-qe__test_generate_enhanced({
  targetPath: "src/services/auth.ts",
  framework: "vitest",
  strategy: "boundary-value"
})
```

#### 3. Analyze Coverage

```typescript
mcp__agentic-qe__coverage_analyze_sublinear({
  paths: ["src/"],
  threshold: 80
})
```

#### 4. Assess Quality

```typescript
mcp__agentic-qe__quality_assess({
  scope: "full",
  includeMetrics: true
})
```

#### 5. Store and Query Patterns (with learning persistence)

```typescript
// Store a learned pattern
mcp__agentic-qe__memory_store({
  key: "patterns/coverage-gap/{timestamp}",
  namespace: "learning",
  value: {
    pattern: "...",
    confidence: 0.95,
    type: "coverage-gap",
    metadata: { /* domain-specific */ }
  },
  persist: true
})

// Query stored patterns
mcp__agentic-qe__memory_query({
  pattern: "patterns/*",
  namespace: "learning",
  limit: 10
})
```

#### 6. Orchestrate Multi-Agent Tasks

```typescript
mcp__agentic-qe__task_orchestrate({
  task: "Full quality assessment of auth module",
  domains: ["test-generation", "coverage-analysis", "security-compliance"],
  parallel: true
})
```

### MCP Tool Reference

| Tool | Description |
|------|-------------|
| `fleet_init` | Initialize QE fleet (MUST call first) |
| `fleet_status` | Get fleet health and agent status |
| `agent_spawn` | Spawn specialized QE agent |
| `test_generate_enhanced` | AI-powered test generation |
| `test_execute_parallel` | Parallel test execution with retry |
| `task_orchestrate` | Orchestrate multi-agent QE tasks |
| `coverage_analyze_sublinear` | O(log n) coverage analysis |
| `quality_assess` | Quality gate evaluation |
| `memory_store` | Store patterns with namespace + persist |
| `memory_query` | Query patterns by namespace/pattern |
| `security_scan_comprehensive` | SAST/DAST scanning |

### Configuration

- **Enabled Domains**: test-generation, test-execution, coverage-analysis, quality-assessment, defect-intelligence, requirements-validation (+7 more)
- **Learning**: Enabled (transformer embeddings)
- **Max Concurrent Agents**: 15
- **Background Workers**: pattern-consolidator, routing-accuracy-monitor, coverage-gap-scanner, flaky-test-detector

### V3 QE Agents

QE agents are in `.claude/agents/v3/`. Use with Task tool:

```javascript
Task({ prompt: "Generate tests", subagent_type: "qe-test-architect", run_in_background: true })
Task({ prompt: "Find coverage gaps", subagent_type: "qe-coverage-specialist", run_in_background: true })
Task({ prompt: "Security audit", subagent_type: "qe-security-scanner", run_in_background: true })
```

### Data Storage

- **Memory Backend**: `.agentic-qe/memory.db` (SQLite)
- **Configuration**: `.agentic-qe/config.yaml`

---
*Generated by AQE v3 init - 2026-04-08T07:18:01.044Z*
