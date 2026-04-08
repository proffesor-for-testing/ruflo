# SFDIPOT Product Factor Analysis and Test Strategy -- Ruflo v3.5

**Date**: 2026-04-08
**Framework**: James Bach's Heuristic Test Strategy Model (HTSM) -- Product Factors (SFDIPOT)
**Scope**: Ruflo v3.5.72 -- Enterprise AI Agent Orchestration Platform
**Codebase**: 792 TypeScript source files, ~413K lines, 20 packages, 144 test files

---

## Table of Contents

1. [Part 1: SFDIPOT Product Factor Analysis](#part-1-sfdipot-product-factor-analysis)
   - [S -- Structure](#s----structure)
   - [F -- Function](#f----function)
   - [D -- Data](#d----data)
   - [I -- Interfaces](#i----interfaces)
   - [P -- Platform](#p----platform)
   - [O -- Operations](#o----operations)
   - [T -- Time](#t----time)
2. [Part 2: Test Strategy](#part-2-test-strategy)
3. [Part 3: Test Plan](#part-3-test-plan)

---

## Part 1: SFDIPOT Product Factor Analysis

### S -- Structure

**What the product IS: code architecture, package dependencies, module coupling, build artifacts.**

#### 1.1 Architecture Analysis

Ruflo v3.5 is a monorepo containing 20 packages under `v3/@claude-flow/`. The architecture follows Domain-Driven Design with bounded contexts:

| Package | Version | Role | Key Dependencies |
|---------|---------|------|-----------------|
| `@claude-flow/cli` | 3.5.72 | Entry point, 41 command files | `@claude-flow/mcp`, `@claude-flow/shared`, `@noble/ed25519`, `semver` |
| `@claude-flow/swarm` | 3.0.0-alpha.6 | Swarm coordination, topologies, consensus | None (standalone) |
| `@claude-flow/memory` | 3.0.0-alpha.13 | AgentDB + HNSW vector search | `agentdb`, `better-sqlite3`, `sql.js` |
| `@claude-flow/mcp` | 3.0.0-alpha.8 | MCP server (stdio/http/ws) | `ajv`, `express`, `helmet`, `ws` |
| `@claude-flow/security` | 3.0.0-alpha.6 | CVE remediation, input validation | `bcrypt`, `zod` |
| `@claude-flow/hooks` | 3.0.0-alpha.7 | 17 hooks + 12 workers | `@claude-flow/memory`, `@claude-flow/neural`, `zod` |
| `@claude-flow/neural` | 3.0.0-alpha.7 | SONA learning, RL algorithms | `@claude-flow/memory`, `@ruvector/sona` |
| `@claude-flow/plugins` | 3.0.0-alpha.7 | Plugin SDK, registry, dependency graph | `events` |
| `@claude-flow/embeddings` | N/A | Vector embeddings, ONNX | Multiple embedding providers |
| `@claude-flow/providers` | N/A | AI provider integrations | External AI APIs |

**Source**: `v3/@claude-flow/cli/package.json` (lines 96-120), `v3/@claude-flow/swarm/package.json`, `v3/@claude-flow/memory/package.json`

#### 1.2 Dependency Graph Risks

- **Version skew across packages**: CLI is at 3.5.72 while all other packages remain at 3.0.0-alpha.x. The CLI uses `^3.0.0-alpha.x` ranges in optionalDependencies. A breaking change in any alpha package could destabilize the CLI silently since these are optional.
- **Optional dependency sprawl**: The CLI has 14 optionalDependencies including WASM packages (`@ruvector/attention-darwin-arm64`, `@ruvector/learning-wasm`, `@ruvector/ruvllm-wasm`, `@ruvector/rvagent-wasm`, `@ruvector/diskann`). Each absent optional package is a degraded-mode code path that needs testing.
- **Native binary dependencies**: `better-sqlite3` requires native compilation; `sql.js` provides a WASM fallback. The memory package declares `os: ["darwin", "linux", "win32"]` and `cpu: ["x64", "arm64"]` -- a 6-cell platform matrix.
- **Circular dependency potential**: `@claude-flow/hooks` depends on `@claude-flow/memory` and `@claude-flow/neural`. `@claude-flow/neural` depends on `@claude-flow/memory`. Hooks also has a `peerDependency` on `@claude-flow/shared`. The plugin system declares 4 optional peerDependencies.

**Source**: `v3/@claude-flow/memory/package.json` (lines 37-45), `v3/@claude-flow/plugins/package.json` (lines 48-67)

#### 1.3 Code Integrity Risks

- **41 CLI command files** in a single directory (`v3/@claude-flow/cli/src/commands/`). Coordination between commands sharing state through shared singletons (`commandRegistry`, `output`) is a coupling risk.
- **Swarm package exports 80+ types** from its index.ts re-exports. The UnifiedSwarmCoordinator consolidates 4 legacy systems (SwarmCoordinator, HiveMind, Maestro, AgentManager). Consolidation residue could harbor inconsistent state machines.
- **Plugin dependency graph** (`v3/@claude-flow/plugins/src/registry/dependency-graph.ts`) implements its own semver parser and comparator (lines 41-60) rather than using the `semver` library. Custom parsers are defect-prone for edge cases (pre-release versions, build metadata).

**Source**: `v3/@claude-flow/swarm/src/index.ts` (lines 42-100), `v3/@claude-flow/plugins/src/registry/dependency-graph.ts` (lines 41-60)

#### 1.4 Suggested Test Approaches

| # | Test Idea | Priority | Automation Fitness |
|---|-----------|----------|--------------------|
| S-01 | Import every public export from each of the 20 packages and confirm no runtime import errors when all optional dependencies are present | P0 | Unit |
| S-02 | Import `@claude-flow/cli` with each optional dependency individually removed; confirm graceful degradation path for each of the 14 optional packages | P0 | Integration |
| S-03 | Run `npm ls --all` in the CLI package and flag any peer dependency warnings or unresolved optional dependencies on each supported platform | P1 | Integration |
| S-04 | Build all 20 packages from clean state (`rm -rf dist && npm run build`) and confirm zero TypeScript compilation errors | P1 | Unit |
| S-05 | Feed the custom semver parser in `dependency-graph.ts` with 50 edge-case version strings (pre-release, build metadata, wildcards, invalid) and compare results against the `semver` npm library | P1 | Unit |
| S-06 | Inject a circular dependency between two plugins and confirm the dependency graph rejects it with a clear error rather than infinite recursion | P2 | Unit |
| S-07 | Measure the compiled `.js` bundle size for each package's dist/ output and set regression thresholds | P2 | Integration |
| S-08 | Load 100+ MCP tools into the ToolRegistry simultaneously and confirm O(1) lookup performance holds under category and tag index pressure | P2 | Unit |

---

### F -- Function

**What the product DOES: core capabilities, calculations, error handling, state transitions, security.**

#### 2.1 Core Capability Inventory

| Capability Area | Key Functions | Source Files |
|----------------|---------------|--------------|
| Swarm Orchestration | `UnifiedSwarmCoordinator.initialize()`, topology selection, domain-based task routing | `v3/@claude-flow/swarm/src/unified-coordinator.ts` |
| Consensus Algorithms | Raft (leader election, log replication), Byzantine (PBFT phases), Gossip (epidemic) | `v3/@claude-flow/swarm/src/consensus/raft.ts`, `byzantine.ts`, `gossip.ts` |
| Memory Management | Semantic search, HNSW indexing, query builder, namespace isolation | `v3/@claude-flow/memory/src/index.ts` |
| MCP Server | JSON-RPC 2.0, tool execution, session management, rate limiting, resource/prompt registries | `v3/@claude-flow/mcp/src/server.ts` |
| CLI | 41 command files, argument parsing, output formatting, command suggestion | `v3/@claude-flow/cli/src/index.ts`, `commands/` |
| Security | Input validation (Zod), path traversal prevention, command injection prevention, password hashing, credential generation | `v3/@claude-flow/security/src/` (13 files) |
| Neural/Learning | SONA integration (<0.05ms adaptation), RL algorithms (PPO, DQN, A2C, SARSA, Q-learning, curiosity-driven), decision transformer | `v3/@claude-flow/neural/src/` (45 files) |
| Hooks/Daemons | ReasoningBank pattern learning, daemon lifecycle, background workers, statusline | `v3/@claude-flow/hooks/src/` (19 files) |
| Plugins | Plugin lifecycle (init/shutdown), registry, dependency graph, IPFS marketplace | `v3/@claude-flow/plugins/src/` (32 files) |
| Embeddings | OpenAI/Transformers.js/ONNX providers, LRU cache, persistent cache, hyperbolic embeddings, normalization (L2, L1, min-max, z-score) | `v3/@claude-flow/embeddings/src/` (11 files) |

#### 2.2 Function-Level Risks

**Consensus algorithms -- correctness under partition**:
- Raft: Election timeout is 150-300ms (`electionTimeoutMinMs/MaxMs`). If heartbeat delivery is delayed beyond 300ms, spurious leader elections could fragment the swarm. The `proposalCounter` is a simple incrementing integer -- no Term-based deduplication for replayed proposals.
- Byzantine: `maxFaultyNodes` defaults to 1. PBFT requires `n >= 3f + 1` nodes. If the swarm has fewer than 4 agents and Byzantine consensus is selected, the algorithm cannot tolerate even 1 fault. No guard validates this invariant at configuration time.

**Source**: `v3/@claude-flow/swarm/src/consensus/raft.ts` (lines 49-59), `v3/@claude-flow/swarm/src/consensus/byzantine.ts` (lines 51-60)

**Agent pool auto-scaling race conditions**:
- `AgentPool` uses `pendingScale` counter and `lastScaleOperation` timestamp with a `cooldownMs` of 30 seconds. If two scale-up requests arrive within the cooldown, only one executes. But `createPooledAgent()` is async -- if it fails, the counter may remain inflated, permanently blocking further scaling.

**Source**: `v3/@claude-flow/swarm/src/agent-pool.ts` (lines 26-60)

**Security functions**:
- `SafeExecutor` uses `execFile` (no shell) with an allowlist -- correct approach. But `blockedPatterns` is a regex array applied to arguments. Regex denial-of-service (ReDoS) on user-supplied blocked patterns is possible.
- `InputValidator` calls `z.setErrorMap(securityErrorMap)` at module load time (line 43). This mutates global Zod state. If any other module also sets a global error map, the last import wins, silently overriding security error messages.

**Source**: `v3/@claude-flow/security/src/safe-executor.ts` (lines 1-68), `v3/@claude-flow/security/src/input-validator.ts` (lines 20-43)

**MCP Server rate limiting**:
- The `RateLimiter` uses a token bucket algorithm with `requestsPerSecond: 100` and `burstSize: 200` by default. Per-session limit is 50 req/s. But there is no IP-based limiting -- a single malicious client could open multiple sessions to bypass per-session limits while staying under the global limit.

**Source**: `v3/@claude-flow/mcp/src/rate-limiter.ts` (lines 33-38)

#### 2.3 Suggested Test Approaches

| # | Test Idea | Priority | Automation Fitness |
|---|-----------|----------|--------------------|
| F-01 | Start a Raft consensus with 5 nodes, kill the leader mid-heartbeat, and measure time-to-new-leader; assert it completes within 2x `electionTimeoutMaxMs` (600ms) | P0 | Integration |
| F-02 | Configure Byzantine consensus with 3 nodes and `maxFaultyNodes: 1`, then attempt to reach consensus; assert the system either rejects the configuration or documents the degraded guarantee | P0 | Unit |
| F-03 | Submit 200 concurrent `checkSession()` calls to the RateLimiter from 10 different session IDs and confirm per-session limits are enforced independently while global limit acts as a ceiling | P1 | Unit |
| F-04 | Register a tool in `ToolRegistry` with a schema that fails validation, then attempt to invoke it; confirm the registry rejects registration and the tool is not callable | P1 | Unit |
| F-05 | Trigger `AgentPool` auto-scale-up to maxSize, then make `createPooledAgent()` fail for the last agent; confirm `pendingScale` resets correctly and subsequent scale requests are not blocked | P1 | Integration |
| F-06 | Supply a ReDoS-prone regex pattern as a `blockedPattern` to `SafeExecutor` and time the argument validation; assert it completes within 100ms even for pathological input | P1 | Unit |
| F-07 | Import `@claude-flow/security` in a process that has already set a custom Zod global error map; confirm security error messages are not silently overridden | P2 | Unit |
| F-08 | Send 50 concurrent MCP JSON-RPC requests with method `tools/call` for the same tool; confirm all execute without deadlock and results are correctly correlated to request IDs | P1 | Integration |
| F-09 | Submit a Raft proposal while a leader election is in progress (split-brain window); confirm the proposal either succeeds after election or fails with a clear error, not silent loss | P0 | Integration |
| F-10 | Feed the `InputValidator` every Zod schema (SafeString, Identifier, Filename, Email, Password, UUID, URL, Semver, Port, IP) with boundary values at exact min/max lengths | P1 | Unit |
| F-11 | Execute the Gossip consensus protocol with 15 agents where 3 agents have 500ms network latency; measure convergence time and confirm eventual consistency within 5 seconds | P2 | Integration |
| F-12 | Invoke the SONA engine `adapt()` method 1000 times with random domain contexts and assert mean latency stays below 0.05ms | P2 | Unit |
| F-13 | Call `PathValidator.validate()` with 100 path traversal payloads (../../etc/passwd variants, URL-encoded, double-encoded, null-byte injected) and confirm all are rejected | P0 | Unit |

---

### D -- Data

**What the product PROCESSES: input/output, persistence, boundaries, formats, integrity.**

#### 3.1 Data Flow Analysis

```
User Input (CLI args / MCP JSON-RPC)
  |
  v
[Input Validation] --> Zod schemas (security module)
  |
  v
[Command Parser] --> CommandContext with flags/positional args
  |
  v
[Swarm Coordinator] --> Agent state, task assignments, consensus proposals
  |         |
  v         v
[Memory]   [Message Bus]
  |         |
  v         v
[AgentDB/SQLite]  [In-memory queues (Deque circular buffer)]
  |
  v
[HNSW Index] --> Float32Array vectors (384-dim or 1536-dim)
  |
  v
[Embeddings] --> LRU cache + persistent SQL cache
```

#### 3.2 Data Persistence

- **Primary store**: SQLite via `better-sqlite3` (native) or `sql.js` (WASM fallback). Path: `.agentic-qe/memory.db`
- **Vector index**: HNSW with parameters M=16, efConstruction=200. Stored as Float32Array vectors.
- **Session state**: In-memory `Map<string, MCPSession>` in the MCP SessionManager. Lost on process restart.
- **Agent state**: In-memory `Map<string, PooledAgent>` in the AgentPool. Lost on process restart.
- **Daemon PID files**: Written to `.claude-flow/pids/` filesystem directory.
- **Pattern learning**: ReasoningBank stores patterns as vectors in AgentDB with quality scores and usage counts.

**Source**: `v3/@claude-flow/hooks/src/reasoningbank/index.ts` (lines 27-56), `v3/@claude-flow/mcp/src/session-manager.ts` (lines 24-29)

#### 3.3 Data Integrity Risks

- **HNSW vector dimensions mismatch**: The memory module accepts configurable dimensions (384 for MiniLM, 1536 for OpenAI). If an embedding provider is swapped without re-indexing, queries against existing vectors with mismatched dimensions will produce garbage similarity scores. No runtime dimension check is documented.
- **SQLite WAL mode under concurrent access**: `better-sqlite3` is synchronous and single-writer. If multiple daemon workers access the same `memory.db` file concurrently, write conflicts could corrupt data or throw SQLITE_BUSY errors.
- **Message bus circular buffer data loss**: The `Deque` implementation in `message-bus.ts` (lines 30-80) uses a circular buffer that doubles in size when full. Under extreme message throughput (>1000 msg/sec target), if the consumer falls behind, the buffer grows unboundedly until OOM -- there is no backpressure or max-size cap.
- **Session state volatility**: MCP session data (max 100 sessions, 30-min timeout) exists only in memory. A server crash loses all active sessions with no recovery mechanism.
- **Embedding cache coherence**: The LRU cache in `embedding-service.ts` (line 42) and the persistent SQLite cache are two separate layers with no invalidation protocol between them. A stale LRU entry could mask an updated persistent entry.

**Source**: `v3/@claude-flow/swarm/src/message-bus.ts` (lines 30-80), `v3/@claude-flow/embeddings/src/embedding-service.ts` (lines 42-60)

#### 3.4 Suggested Test Approaches

| # | Test Idea | Priority | Automation Fitness |
|---|-----------|----------|--------------------|
| D-01 | Store 1000 vectors at dimension 384, then switch the embedding generator to dimension 1536 and perform a semantic search; confirm the system detects the dimension mismatch and raises a clear error | P0 | Integration |
| D-02 | Open two concurrent connections to the same SQLite database file via `better-sqlite3` and issue simultaneous writes; confirm one fails gracefully with SQLITE_BUSY rather than corrupting data | P0 | Integration |
| D-03 | Produce messages at 2000/sec into the MessageBus Deque for 60 seconds with a consumer processing at 500/sec; measure memory growth and confirm it does not exceed a defined threshold (e.g., 512MB) | P1 | Integration |
| D-04 | Kill the MCP server process while 50 sessions are active, restart it, and confirm all clients receive connection-reset errors rather than hanging indefinitely | P1 | Integration |
| D-05 | Store an embedding in the persistent cache, then query it through the LRU cache layer; update the persistent cache entry directly, then query again; confirm the LRU returns the stale value (documenting the coherence gap) | P2 | Unit |
| D-06 | Store a ReasoningBank pattern with `quality: 0.1`, query for it, then update quality to `0.95` and query again; confirm the updated quality is reflected in search ranking | P2 | Integration |
| D-07 | Write 10,000 memory entries with tags, then query by tag intersection (e.g., `['security', 'critical']`); measure query time and confirm it stays under 100ms | P2 | Integration |
| D-08 | Input the maximum allowed content size (1MB per `LIMITS.MAX_CONTENT_LENGTH`) through the InputValidator and confirm it processes without timeout or memory spike | P1 | Unit |
| D-09 | Store entries in 20 different namespaces, then query with a namespace filter; confirm zero cross-namespace leakage | P1 | Integration |
| D-10 | Insert a Float32Array vector with NaN values into the HNSW index and confirm it is rejected or handled without corrupting the index structure | P1 | Unit |

---

### I -- Interfaces

**How the product CONNECTS: APIs, UI, protocols, integrations.**

#### 4.1 Interface Inventory

| Interface | Protocol | Transport | Source |
|-----------|----------|-----------|--------|
| MCP Server | JSON-RPC 2.0 (MCP 2025-11-25) | stdio, HTTP, WebSocket, in-process | `v3/@claude-flow/mcp/src/server.ts` |
| CLI | POSIX arguments, interactive/piped modes | stdin/stdout | `v3/@claude-flow/cli/src/index.ts` |
| Plugin API | TypeScript interface (`IPlugin`) | In-process | `v3/@claude-flow/plugins/src/core/plugin-interface.ts` |
| Message Bus | Internal pub/sub with acknowledgments | In-memory | `v3/@claude-flow/swarm/src/message-bus.ts` |
| Tool Registry | Tool registration + JSON schema validation | In-process | `v3/@claude-flow/mcp/src/tool-registry.ts` |
| Session Manager | Session lifecycle (create/init/close/expire) | In-process | `v3/@claude-flow/mcp/src/session-manager.ts` |
| Connection Pool | Pooled connections with health checks | In-process | `v3/@claude-flow/mcp/src/connection-pool.ts` |
| Hooks Bridge | Hook registration, event dispatch, daemon control | In-process + filesystem | `v3/@claude-flow/hooks/src/bridge/official-hooks-bridge.ts` |
| Embedding Providers | OpenAI API, Transformers.js, ONNX, mock | HTTP + in-process | `v3/@claude-flow/embeddings/src/embedding-service.ts` |
| OAuth | OAuth 2.0 authorization flows | HTTP | `v3/@claude-flow/mcp/src/oauth.ts` |

#### 4.2 Interface Contract Risks

- **MCP protocol version negotiation**: The server hardcodes `protocolVersion: { major: 2025, minor: 11, patch: 25 }`. If a client sends a different protocol version in `initialize`, the negotiation behavior is critical. Accepting an incompatible version silently would cause subtle tool invocation failures.
- **WebSocket transport**: `ws` library connection handling needs proper close-code propagation. Abnormal closures (code 1006) must trigger session cleanup.
- **Plugin lifecycle contract**: `IPlugin` requires `initialize(context)` and `shutdown()`. If a plugin's `initialize()` throws, the system must not leave the plugin in a partially-initialized state that could be invoked.
- **ToolRegistry schema validation**: Uses `ajv` for JSON Schema validation of tool input schemas. Schema version compatibility (Draft-07 vs 2020-12) is not explicitly configured.
- **CLI interactive vs piped mode detection**: `process.stdin.isTTY` determines behavior (line 58 of `cli/src/index.ts`). When piped through `npx`, TTY detection can be unreliable, causing the CLI to enter MCP server mode unexpectedly.

**Source**: `v3/@claude-flow/mcp/src/server.ts` (lines 85-104), `v3/@claude-flow/cli/src/index.ts` (line 58)

#### 4.3 Suggested Test Approaches

| # | Test Idea | Priority | Automation Fitness |
|---|-----------|----------|--------------------|
| I-01 | Send an MCP `initialize` request with protocol version `{major: 2024, minor: 1, patch: 0}` (older version) and confirm the server either negotiates down or returns a clear version-mismatch error | P0 | Integration |
| I-02 | Open a WebSocket connection to the MCP server, send a valid `initialize`, then forcefully terminate the TCP connection (no close frame); confirm the server cleans up the orphaned session within `sessionTimeout` | P1 | Integration |
| I-03 | Register a plugin whose `initialize()` throws an Error; confirm `plugin.state` is not `'active'` and subsequent tool invocations against that plugin return "plugin not initialized" errors | P1 | Unit |
| I-04 | Register 314 MCP tools (matching the documented count) and invoke `tools/list`; confirm the response contains all tools with correct schemas and the response time is under 200ms | P1 | Integration |
| I-05 | Send a JSON-RPC request with a malformed `id` field (object, array, negative number, empty string) and confirm the server responds with a JSON-RPC error per the spec | P1 | Unit |
| I-06 | Pipe the CLI via `echo "status" | npx @claude-flow/cli` and confirm it correctly detects non-TTY mode and does not enter interactive prompt mode | P2 | E2E |
| I-07 | Send an MCP `tools/call` request for a non-existent tool name and confirm the error response includes the tool name and a suggestion for the closest match | P2 | Unit |
| I-08 | Connect via all 4 transport types (stdio, HTTP, WebSocket, in-process) and execute the same tool call on each; confirm identical results | P1 | Integration |
| I-09 | Send a JSON-RPC batch request (array of 10 requests) and confirm all 10 responses are returned with correct correlation | P2 | Integration |
| I-10 | Invoke the `resources/subscribe` MCP method for a resource URI, then update that resource; confirm the client receives a `notifications/resources/updated` notification | P2 | Integration |

---

### P -- Platform

**What the product DEPENDS ON: OS, runtime, hardware, external services, distribution.**

#### 5.1 Platform Matrix

| Dimension | Supported Values | Source |
|-----------|-----------------|--------|
| Node.js | >= 20.0.0 (required), 18.x (warn) | `v3/@claude-flow/hooks/package.json` (line 82), `doctor.ts` |
| OS | darwin, linux, win32 | `v3/@claude-flow/memory/package.json` (lines 37-41) |
| CPU | x64, arm64 | `v3/@claude-flow/memory/package.json` (lines 42-44) |
| Shell | /bin/sh (unix), cmd.exe (windows) | `v3/@claude-flow/cli/src/commands/doctor.ts` (line 27) |
| SQLite | `better-sqlite3` (native) or `sql.js` (WASM fallback) | `v3/@claude-flow/memory/package.json` |
| WASM Modules | `@ruvector/attention-darwin-arm64`, `@ruvector/learning-wasm`, `@ruvector/ruvllm-wasm`, `@ruvector/rvagent-wasm`, `@ruvector/diskann`, `@ruvector/sona` | `v3/@claude-flow/cli/package.json` (lines 110-118) |
| npm | >= 9 | `doctor.ts` |
| Distribution | npm registry, `npx` execution | `package.json` publishConfig |

#### 5.2 Platform Risks

- **Platform-specific WASM binary**: `@ruvector/attention-darwin-arm64` is explicitly darwin-arm64 only. No equivalent packages listed for linux-x64 or win32. Users on those platforms who attempt to use attention features will get a silent failure or cryptic import error.
- **`better-sqlite3` native compilation**: Requires `node-gyp`, Python, and a C++ compiler. Users in constrained environments (Docker alpine, CI without build tools) will fail at `npm install` time. The `sql.js` fallback exists but the selection logic needs to be robust.
- **`postinstall` script complexity**: The CLI `postinstall` (line 87 of `package.json`) runs a one-liner Node script that resolves `agentdb` paths and copies controller files. This breaks if `agentdb` module resolution changes, the dist structure changes, or `cpSync` is not available (Node < 16.7).
- **Docker/container**: No Dockerfile found in the repository. Container deployment scenarios for the MCP server (HTTP/WebSocket transports) are undocumented.
- **npx execution model**: Users run via `npx @claude-flow/cli@latest`. Each `npx` invocation downloads fresh, adding 5-15 seconds startup latency. Cached installs behave differently from fresh installs.

**Source**: `v3/@claude-flow/cli/package.json` (line 87, lines 102-119)

#### 5.3 Suggested Test Approaches

| # | Test Idea | Priority | Automation Fitness |
|---|-----------|----------|--------------------|
| P-01 | Run `npm install` for `@claude-flow/cli` in a minimal Docker container (node:20-alpine) without build tools and confirm `better-sqlite3` fails gracefully while `sql.js` WASM fallback activates | P0 | Integration |
| P-02 | Execute the CLI `doctor` command on linux-x64, darwin-arm64, and win32 and confirm all health checks pass on each platform | P1 | E2E |
| P-03 | Run the `postinstall` script on Node.js 20, 22, and 24 and confirm agentdb controller files are copied correctly in each version | P1 | Integration |
| P-04 | Attempt to import `@ruvector/attention-darwin-arm64` on a linux-x64 system and confirm the failure is caught and the CLI still starts without attention features | P1 | Integration |
| P-05 | Time `npx @claude-flow/cli@latest --version` from a cold npm cache and confirm it completes within 30 seconds; time it from warm cache and confirm under 3 seconds | P2 | E2E |
| P-06 | Run the full test suite under Node.js 20.x and 22.x and diff the results for any version-specific failures | P1 | Integration |
| P-07 | Execute memory operations using `sql.js` WASM backend and `better-sqlite3` native backend and confirm identical query results for the same dataset | P1 | Integration |
| P-08 | Set `CLAUDE_FLOW_MEMORY_PATH` to a read-only directory and confirm the memory module reports a clear initialization error rather than silently failing writes | P2 | Unit |

---

### O -- Operations

**How the product is USED: installation, administration, monitoring, upgrade, recovery.**

#### 6.1 Operational Workflows

| Operation | Entry Point | Risk Level |
|-----------|-------------|------------|
| Installation | `npx @claude-flow/cli@latest init --wizard` | Medium |
| Health Check | `npx @claude-flow/cli@latest doctor --fix` | Low |
| Swarm Start | `npx @claude-flow/cli@latest swarm init --topology hierarchical` | High |
| Agent Spawn | `npx @claude-flow/cli@latest agent spawn -t coder --name X` | Medium |
| Memory Init | `npx @claude-flow/cli@latest memory init --force --verbose` | High |
| Daemon Start | `npx @claude-flow/cli@latest daemon start` | Medium |
| Plugin Install | `npx @claude-flow/cli@latest plugins install <name>` | Medium |
| V2-to-V3 Migration | `npx @claude-flow/cli@latest migrate run --backup` | Critical |
| Security Scan | `npx @claude-flow/cli@latest security scan --depth full` | Low |
| Performance Bench | `npx @claude-flow/cli@latest performance benchmark --suite all` | Low |

#### 6.2 Operations Risks

- **`memory init --force`**: The `--force` flag implies destructive re-initialization. If this deletes the existing `memory.db` without backup, all stored patterns, embeddings, and learning history are permanently lost. The CLAUDE.md warns "NEVER run `rm -f` on `.agentic-qe/` or `*.db` files without confirmation" -- this suggests the risk is recognized but the CLI may not enforce confirmation.
- **Daemon lifecycle**: `DaemonManager` tracks restart counts with `maxRestartAttempts: 3`. If a daemon fails 3 times, it stops retrying. There is no alerting mechanism -- the daemon silently stops, and users discover the failure only when features depending on it break.
- **Migration rollback safety**: The `migrate rollback` command exists but rollback fidelity depends on the backup quality. If the backup was taken mid-transaction or with an inconsistent SQLite snapshot, rollback could produce a corrupted state.
- **MCP server `--fix` mode**: The doctor command offers auto-fix suggestions. If `--fix` mode directly executes repairs (e.g., reinitializing a corrupt database), it could destroy data without explicit consent.

**Source**: `v3/@claude-flow/hooks/src/daemons/index.ts` (lines 30-37, lines 42-60), `v3/@claude-flow/cli/src/commands/doctor.ts`

#### 6.3 Suggested Test Approaches

| # | Test Idea | Priority | Automation Fitness |
|---|-----------|----------|--------------------|
| O-01 | Run `memory init --force` on a database with 500 stored entries; confirm it creates a backup file before destructing, and the backup is restorable | P0 | Integration |
| O-02 | Start a daemon, make it fail 3 times in succession, and confirm the DaemonManager emits a "max-restarts-exceeded" event or logs a clear warning | P1 | Integration |
| O-03 | Run `migrate run --backup` from a V2 schema database, then `migrate rollback`; confirm the database returns to exact pre-migration state with zero data loss | P0 | E2E |
| O-04 | Execute `doctor --fix` with a corrupt `config.yaml` and confirm it repairs only the specific corruption without touching unrelated configuration | P2 | Integration |
| O-05 | Run `init --wizard` in non-interactive mode (piped stdin) and confirm it uses sensible defaults rather than hanging for user input | P1 | E2E |
| O-06 | Spawn 15 agents via `agent spawn`, then run `swarm status` and confirm all 15 are listed with correct types, domains, and health status | P1 | Integration |
| O-07 | Install a plugin, then uninstall it, and confirm all plugin artifacts (registered tools, hooks, workers) are fully cleaned up | P2 | Integration |
| O-08 | Run `security scan --depth full` against the codebase and confirm it reports known CVE remediations (CVE-2, CVE-3, HIGH-1, HIGH-2) as resolved | P2 | E2E |
| O-09 | Start the daemon, kill the process with SIGKILL (no graceful shutdown), then start it again; confirm PID file staleness is detected and the new daemon starts cleanly | P1 | Integration |
| O-10 | Execute `hooks worker list` and confirm all 12 documented workers are present with correct priorities | P2 | Unit |

---

### T -- Time

**WHEN things happen: concurrency, scheduling, timeouts, sequences, long-running operations.**

#### 7.1 Time-Dependent Behaviors

| Behavior | Timing Parameters | Source |
|----------|-------------------|--------|
| Raft election timeout | 150-300ms randomized | `consensus/raft.ts` (lines 57-58) |
| Raft heartbeat interval | 50ms | `consensus/raft.ts` (line 59) |
| Byzantine view change timeout | 5000ms | `consensus/byzantine.ts` (line 59) |
| MCP session timeout | 30 minutes | `session-manager.ts` (line 26) |
| MCP session cleanup interval | 60 seconds | `session-manager.ts` (line 27) |
| MCP request timeout | 30 seconds | `server.ts` (line 48) |
| Connection pool idle timeout | 30 seconds | `connection-pool.ts` (line 22) |
| Connection pool eviction interval | 10 seconds | `connection-pool.ts` (line 25) |
| Agent pool health check interval | Configurable (default from SWARM_CONSTANTS) | `agent-pool.ts` (line 46) |
| Agent pool scale cooldown | 30 seconds | `agent-pool.ts` (line 44) |
| Rate limiter cleanup interval | 60 seconds | `rate-limiter.ts` (line 37) |
| Daemon restart max attempts | 3 attempts | `daemons/index.ts` (line 37) |
| CLI startup target | < 500ms | CLAUDE.md |
| MCP response target | < 100ms | CLAUDE.md |
| SONA adaptation target | < 0.05ms | CLAUDE.md |
| HNSW search performance | 150x-12,500x vs brute force | CLAUDE.md |

#### 7.2 Time-Related Risks

- **Timer leak on shutdown**: `SessionManager.startCleanupTimer()`, `ConnectionPool` eviction timer, `RateLimiter` cleanup timer, and `AgentPool` health check interval all create `setInterval` timers. If the server shuts down without calling `destroy()` or `stop()` on each component, these timers prevent Node.js process exit, causing zombie processes.
- **Consensus timeout cascades**: If a Raft leader's heartbeat is delayed by GC pause (>50ms), followers begin election. If 3+ followers start elections simultaneously, vote-splitting could prevent any candidate from winning, causing repeated election rounds until `maxRounds` (10) is exhausted.
- **Clock skew in distributed state**: The `RaftLogEntry.timestamp` and `ByzantineMessage.timestamp` use `new Date()` from the local clock. In a distributed deployment across machines with clock skew, timestamp-based ordering could produce inconsistent log entries.
- **Connection pool starvation**: `acquireTimeout: 5000ms` with `maxWaitingClients: 50`. Under sustained load, 50 clients queued for 5 seconds each means 250 client-seconds of blocked I/O. If the pool is exhausted by slow consumers, the entire MCP server becomes unresponsive.
- **Long-running swarm sessions**: No documented maximum session duration. A swarm running for days could accumulate memory from pattern learning, message bus entries, and metric collection without bounds.

**Source**: `v3/@claude-flow/mcp/src/session-manager.ts` (lines 33-48), `v3/@claude-flow/mcp/src/connection-pool.ts` (lines 18-25)

#### 7.3 Suggested Test Approaches

| # | Test Idea | Priority | Automation Fitness |
|---|-----------|----------|--------------------|
| T-01 | Start the MCP server, call `stop()`, then check with `process._getActiveHandles()` that no lingering timers remain; assert clean exit within 2 seconds | P0 | Integration |
| T-02 | Run a Raft consensus cluster of 5 nodes, inject a 200ms GC pause on the leader (using `--expose-gc` and `global.gc()`), and confirm a new leader is elected without data loss | P1 | Integration |
| T-03 | Create 50 MCP sessions, let them idle for 31 minutes, and confirm all are expired and cleaned up by the next cleanup cycle (60-second interval) | P1 | Integration |
| T-04 | Exhaust the connection pool (acquire all `maxConnections: 10`), then send 51 additional acquire requests; confirm the 51st is rejected immediately (exceeds `maxWaitingClients: 50`) rather than hanging | P1 | Unit |
| T-05 | Run a swarm with 15 agents for 2 hours of simulated operation (accelerated timers); measure memory growth over time and confirm it stays within 2x the initial memory footprint | P2 | Integration |
| T-06 | Measure CLI startup time (`time npx @claude-flow/cli@latest --version`) from warm npm cache across 10 runs and assert p95 is under 500ms | P1 | E2E |
| T-07 | Send an MCP `tools/call` request for a tool that takes 35 seconds to execute (exceeding the 30-second `requestTimeout`); confirm the server returns a timeout error rather than hanging | P1 | Unit |
| T-08 | Start the rate limiter, exhaust the global bucket (200 tokens), wait exactly 1 second, then send 100 more requests; confirm exactly 100 are allowed (matching `requestsPerSecond: 100` refill rate) | P2 | Unit |
| T-09 | Trigger 5 simultaneous Raft leader elections (5-way split vote) and confirm the system resolves to a single leader within 10 election rounds | P2 | Integration |
| T-10 | Start the AgentPool health check, make one agent fail its health check, and confirm it is removed from the `available` set within one health check interval | P2 | Unit |

---

## Part 2: Test Strategy

### 2.1 Test Objectives

1. **Correctness**: Validate that consensus algorithms, memory operations, and security controls produce correct results under normal and adversarial conditions.
2. **Robustness**: Confirm graceful degradation when optional dependencies are missing, external services are unavailable, or resources are exhausted.
3. **Performance**: Verify published performance targets (CLI <500ms startup, MCP <100ms response, SONA <0.05ms adaptation, HNSW 150x+ speedup).
4. **Security**: Validate all CVE remediations (CVE-2, CVE-3, HIGH-1, HIGH-2) and ensure no regressions in input validation, path traversal prevention, and command injection protection.
5. **Compatibility**: Confirm operation across the supported platform matrix (3 OSes x 2 architectures x 2+ Node.js versions).

### 2.2 Test Approach per Quality Characteristic

| Quality Characteristic | Approach | Test Types |
|----------------------|----------|------------|
| **Functional Correctness** | Boundary value analysis on all Zod schemas, state transition testing for consensus algorithms, equivalence partitioning for CLI commands | Unit, Integration |
| **Reliability** | Fault injection into agent pools, chaos testing of daemon restarts, forced SQLite corruption recovery | Integration, Chaos |
| **Performance Efficiency** | Benchmark suites for HNSW search, MCP tool execution, CLI startup, SONA adaptation, message bus throughput | Performance |
| **Security** | OWASP-aligned path traversal tests, command injection fuzz testing, ReDoS detection on regex patterns, credential generation entropy validation | Unit, Security |
| **Compatibility** | Cross-platform CI matrix (darwin-arm64, linux-x64, win32-x64), Node.js version matrix (20, 22, 24) | E2E |
| **Maintainability** | Type coverage analysis, dependency freshness checks, dead code detection across 20 packages | Unit, Static Analysis |
| **Portability** | SQLite backend interchangeability (better-sqlite3 vs sql.js), transport interchangeability (stdio vs HTTP vs WebSocket) | Integration |

### 2.3 Risk-Based Test Prioritization Matrix

| Risk Area | Likelihood | Impact | Priority | Test Coverage Focus |
|-----------|------------|--------|----------|-------------------|
| Consensus algorithm incorrectness under partition | Medium | Critical | P0 | Raft split-brain, Byzantine f < n/3 invariant |
| Security CVE regression | Low | Critical | P0 | Path traversal, command injection, credential hardcoding |
| Memory data corruption (SQLite concurrent access) | Medium | High | P0 | WAL mode, concurrent writes, dimension mismatch |
| Optional dependency degradation failures | High | Medium | P1 | 14 optional packages, WASM fallback paths |
| Timer/resource leaks in long-running sessions | Medium | High | P1 | Handle cleanup, memory growth, GC interaction |
| MCP protocol version negotiation failure | Medium | Medium | P1 | Version mismatch, capability negotiation |
| Plugin lifecycle state corruption | Medium | Medium | P1 | Initialize failure, partial shutdown |
| Agent pool auto-scaling deadlock | Low | High | P1 | Scale-up failure, pendingScale counter |
| Rate limiter bypass via multi-session | Medium | Medium | P2 | Session multiplication, global vs per-session |
| CLI command argument parsing edge cases | Low | Low | P2 | Unicode args, very long args, shell escaping |
| Embedding cache coherence | Low | Low | P3 | LRU vs persistent cache staleness |
| Custom semver parser edge cases | Low | Low | P3 | Pre-release, build metadata, ranges |

### 2.4 Test Types Required

| Test Type | Scope | Tool | Estimated Count |
|-----------|-------|------|----------------|
| **Unit** | Individual functions, schemas, validators, algorithms | Vitest | 350-400 |
| **Integration** | Cross-package interactions, database operations, swarm coordination | Vitest + test fixtures | 150-200 |
| **Contract** | MCP JSON-RPC protocol compliance, Plugin API interface contracts | Custom JSON-RPC client | 40-60 |
| **E2E** | CLI command execution, npx invocation, doctor workflow | Child process exec | 50-80 |
| **Performance** | HNSW search benchmarks, MCP throughput, CLI startup, SONA latency | Vitest bench + custom harness | 30-50 |
| **Security** | Path traversal fuzzing, injection testing, credential entropy | Custom security harness | 40-60 |
| **Chaos** | Agent failures, network partitions, SQLite corruption, timer manipulation | Custom chaos framework | 20-30 |

**Total estimated tests: 680-880**

### 2.5 Entry/Exit Criteria

**Entry Criteria**:
- All 20 packages build without TypeScript errors
- `npm install` succeeds on the CI platform
- SQLite database initializes without corruption
- Doctor health check returns zero `fail` results

**Exit Criteria**:
- All P0 tests pass (zero tolerance)
- P1 tests achieve >= 95% pass rate
- P2 tests achieve >= 90% pass rate
- Performance benchmarks meet published targets within 10% tolerance
- Security scan returns zero critical/high findings
- Code coverage >= 70% on security module, >= 60% overall

---

## Part 3: Test Plan

### Phase 1: Critical Path Testing (Highest Risk Areas)

**Duration**: 2 weeks
**Focus**: P0 risks -- consensus correctness, security regressions, data integrity

| ID | Test Area | Tests | Automation | Notes |
|----|-----------|-------|------------|-------|
| 1.1 | Raft consensus correctness | 15 | Integration | Leader election, split-brain, log replication |
| 1.2 | Byzantine consensus invariants | 10 | Integration | f < n/3 validation, PBFT phase transitions |
| 1.3 | Security CVE verification | 20 | Unit | Path traversal (100 payloads), command injection, credential hardcoding |
| 1.4 | InputValidator boundary values | 25 | Unit | Every Zod schema at min/max boundaries |
| 1.5 | SQLite data integrity | 10 | Integration | Concurrent access, WAL mode, corruption recovery |
| 1.6 | HNSW dimension mismatch | 5 | Integration | Cross-dimension query rejection |
| 1.7 | Optional dependency degradation | 14 | Integration | One test per optional package removal |
| 1.8 | Timer leak detection | 5 | Integration | Server start/stop handle verification |

**Phase 1 total: ~104 tests**

### Phase 2: Integration and Contract Testing

**Duration**: 2 weeks
**Focus**: Cross-package interactions, API contracts, protocol compliance

| ID | Test Area | Tests | Automation | Notes |
|----|-----------|-------|------------|-------|
| 2.1 | MCP JSON-RPC protocol compliance | 40 | Contract | All method handlers, error codes, batch requests |
| 2.2 | MCP transport interchangeability | 12 | Integration | Same operations on stdio, HTTP, WebSocket, in-process |
| 2.3 | Plugin lifecycle contracts | 15 | Unit | Initialize, shutdown, error states, dependency resolution |
| 2.4 | CLI command coverage | 41 | E2E | One smoke test per command file |
| 2.5 | Memory API contracts | 20 | Integration | Store, search, query, namespace isolation |
| 2.6 | Swarm coordination workflows | 15 | Integration | Init, spawn agents, assign tasks, consensus, shutdown |
| 2.7 | Hooks registration and dispatch | 12 | Integration | Register, trigger, daemon management |
| 2.8 | Embedding provider contracts | 8 | Integration | OpenAI, Transformers.js, mock providers |

**Phase 2 total: ~163 tests**

### Phase 3: Non-Functional Testing (Performance, Security, Reliability)

**Duration**: 2 weeks
**Focus**: Published performance targets, deep security analysis, long-running stability

| ID | Test Area | Tests | Automation | Notes |
|----|-----------|-------|------------|-------|
| 3.1 | HNSW search benchmarks | 10 | Performance | 150x-12,500x speedup validation at various dataset sizes |
| 3.2 | MCP response time | 8 | Performance | <100ms target across all tool categories |
| 3.3 | CLI startup time | 5 | Performance | <500ms target, cold/warm cache |
| 3.4 | SONA adaptation latency | 5 | Performance | <0.05ms target, 1000-iteration benchmark |
| 3.5 | Message bus throughput | 5 | Performance | 1000+ msg/sec target |
| 3.6 | ReDoS resistance | 10 | Security | Pathological regex inputs across all validators |
| 3.7 | OWASP path traversal (extended) | 15 | Security | Encoded, double-encoded, null-byte, unicode |
| 3.8 | Rate limiter stress test | 8 | Performance | Multi-session bypass, burst handling |
| 3.9 | Memory leak detection (2-hour run) | 3 | Performance | Memory growth monitoring under sustained load |
| 3.10 | Connection pool exhaustion | 5 | Performance | Queue depth, timeout behavior |
| 3.11 | Cross-platform matrix | 6 | E2E | 3 OS x 2 Node.js versions |

**Phase 3 total: ~80 tests**

### Phase 4: Edge Cases and Chaos Testing

**Duration**: 1 week
**Focus**: Failure modes, recovery paths, extreme usage

| ID | Test Area | Tests | Automation | Notes |
|----|-----------|-------|------------|-------|
| 4.1 | Agent failure injection | 8 | Chaos | Kill agents mid-task, verify recovery |
| 4.2 | Network partition simulation | 6 | Chaos | Split swarm, verify consensus recovery |
| 4.3 | SQLite corruption recovery | 4 | Chaos | Corrupt WAL, corrupt database, verify backup restore |
| 4.4 | Daemon crash-restart cycles | 5 | Chaos | SIGKILL, PID staleness, max restart exhaustion |
| 4.5 | Extreme swarm sizes | 4 | Integration | 1 agent, 15 agents, 100 agents (max), 101 agents (over-limit) |
| 4.6 | Memory pressure | 4 | Chaos | Force OOM conditions, verify graceful degradation |
| 4.7 | Clock manipulation | 3 | Chaos | System clock jumps forward/backward during consensus |
| 4.8 | Concurrent migration | 2 | Chaos | Two migrate commands simultaneously |

**Phase 4 total: ~36 tests**

### Test Count Summary

| Phase | Tests | Duration | Automation % |
|-------|-------|----------|-------------|
| Phase 1: Critical Path | 104 | 2 weeks | 100% |
| Phase 2: Integration/Contract | 163 | 2 weeks | 95% |
| Phase 3: Non-Functional | 80 | 2 weeks | 90% |
| Phase 4: Chaos/Edge | 36 | 1 week | 85% |
| **Total** | **383** | **7 weeks** | **94%** |

### Test Automation Fitness Distribution

| Category | Count | Percentage |
|----------|-------|-----------|
| Unit Tests | 140 | 36.6% |
| Integration Tests | 148 | 38.6% |
| E2E Tests | 35 | 9.1% |
| Performance Tests | 28 | 7.3% |
| Security Tests | 18 | 4.7% |
| Chaos Tests | 14 | 3.7% |

### Test Environment Requirements

| Environment | Purpose | Configuration |
|-------------|---------|--------------|
| CI Linux x64 | Primary test execution | Node.js 20+22, Ubuntu 22.04, 4 CPU, 8GB RAM |
| CI macOS arm64 | Platform compatibility | Node.js 20, macOS 14, M-series CPU |
| CI Windows x64 | Platform compatibility | Node.js 20, Windows Server 2022 |
| Docker alpine | Minimal environment testing | node:20-alpine (no build tools) |
| Load test environment | Performance/chaos testing | 8 CPU, 16GB RAM, SSD storage |
| Long-running environment | Stability testing | Dedicated VM for 2+ hour swarm sessions |

### Human Exploration Sessions (Minimum 10% of Effort)

| Session | SFDIPOT Focus | Charter | Duration |
|---------|---------------|---------|----------|
| HE-01 | Function + Time | Explore Raft consensus behavior under varying network latencies using manual agent manipulation | 90 min |
| HE-02 | Data + Interfaces | Investigate what happens when the same memory key is stored simultaneously from two different MCP sessions | 60 min |
| HE-03 | Operations | Walk through the complete V2-to-V3 migration path with a real V2 database and document every surprise | 120 min |
| HE-04 | Structure + Platform | Install Ruflo on a fresh machine (no prior npm cache) and document every friction point, missing dependency, and confusing error message | 90 min |
| HE-05 | Function + Security | Attempt to escalate privileges through the claims system (`claims check/grant/revoke/list`) using creative input sequences | 90 min |
| HE-06 | Interfaces | Use the plugin SDK to build a minimal plugin from scratch using only the published API documentation; identify documentation gaps | 120 min |

**Reasoning for human exploration**: Consensus algorithms under real network conditions, migration workflows, first-run experience, and privilege escalation attempts all require adaptive, judgment-rich testing that automated scripts cannot replicate. These areas have high uncertainty and benefit from a tester's ability to follow hunches and change direction mid-session.

---

## Appendix A: Clarifying Questions

The following questions surface gaps discovered during the SFDIPOT analysis. Answers would refine test priorities.

1. **Structure**: What is the release coordination strategy for the 20 packages? Can `@claude-flow/cli@3.5.72` be published while `@claude-flow/swarm` stays at `3.0.0-alpha.6`? What compatibility guarantees exist between these version ranges?

2. **Function**: Is the Raft consensus implementation intended for use across network boundaries (distributed machines), or only for in-process agent coordination? The answer fundamentally changes the clock-skew and partition testing requirements.

3. **Data**: Is there a documented maximum dataset size for the HNSW index? At what point does the 150x-12,500x speedup claim degrade, and what is the memory footprint per 1000 vectors?

4. **Interfaces**: Does the MCP server support the full MCP 2025-11-25 specification, including elicitation, audio content, and structured tool output? Or is it a subset implementation? This determines the contract test scope.

5. **Platform**: Are the `@ruvector/*` WASM packages published for all 6 cells of the OS/CPU matrix, or only for specific platforms? Which features are unavailable on unsupported platforms?

6. **Operations**: Does `memory init --force` create an automatic backup? If not, is there a separate backup command? What is the documented recovery procedure for a corrupted `memory.db`?

7. **Time**: What is the expected maximum lifetime of a swarm session? Are there any automated cleanup mechanisms for long-running swarms (memory consolidation, old pattern eviction, message bus pruning)?

8. **Security**: Has the `SafeExecutor` allowlist been audited against the full set of CLI commands? Are there commands that require shell interpretation (pipes, redirects) that the `execFile` approach cannot support?

9. **Function**: The ReasoningBank uses dynamic imports for optional dependencies (`AgentDBAdapter`, `HNSWIndex`, `EmbeddingServiceImpl` -- all initialized to `null`). What is the documented behavior when none of these are available? Is there a minimum viable configuration?

10. **Operations**: The 12 background workers (ultralearn, optimize, consolidate, predict, audit, map, preload, deepdive, document, refactor, benchmark, testgaps) -- which are enabled by default, and what is the resource impact of running all 12 simultaneously?

---

## Appendix B: Key File References

| Package | Key File | Lines | Relevance |
|---------|----------|-------|-----------|
| cli | `v3/@claude-flow/cli/src/index.ts` | 100+ | CLI entry point, TTY detection, command routing |
| cli | `v3/@claude-flow/cli/src/commands/doctor.ts` | 60+ | Health check implementation, platform detection |
| swarm | `v3/@claude-flow/swarm/src/unified-coordinator.ts` | 80+ | 15-agent hierarchy, domain routing |
| swarm | `v3/@claude-flow/swarm/src/consensus/raft.ts` | 60+ | Raft election, heartbeat timing |
| swarm | `v3/@claude-flow/swarm/src/consensus/byzantine.ts` | 60+ | PBFT phases, fault tolerance |
| swarm | `v3/@claude-flow/swarm/src/message-bus.ts` | 80+ | Circular buffer Deque, throughput targets |
| swarm | `v3/@claude-flow/swarm/src/topology-manager.ts` | 80+ | Topology types, node management |
| swarm | `v3/@claude-flow/swarm/src/agent-pool.ts` | 60+ | Pool lifecycle, auto-scaling |
| memory | `v3/@claude-flow/memory/src/index.ts` | 100+ | Unified memory API, HNSW types |
| mcp | `v3/@claude-flow/mcp/src/server.ts` | 100+ | MCP server, protocol version, capabilities |
| mcp | `v3/@claude-flow/mcp/src/types.ts` | 100+ | Transport types, auth config, pool config |
| mcp | `v3/@claude-flow/mcp/src/tool-registry.ts` | 100+ | Tool registration, schema validation |
| mcp | `v3/@claude-flow/mcp/src/session-manager.ts` | 80+ | Session lifecycle, timeout, cleanup |
| mcp | `v3/@claude-flow/mcp/src/rate-limiter.ts` | 80+ | Token bucket, per-session limits |
| mcp | `v3/@claude-flow/mcp/src/connection-pool.ts` | 60+ | Connection pooling, eviction |
| security | `v3/@claude-flow/security/src/index.ts` | 80+ | CVE remediation exports |
| security | `v3/@claude-flow/security/src/input-validator.ts` | 100+ | Zod schemas, validation limits |
| security | `v3/@claude-flow/security/src/safe-executor.ts` | 80+ | Command injection prevention |
| security | `v3/@claude-flow/security/src/path-validator.ts` | 80+ | Path traversal prevention |
| hooks | `v3/@claude-flow/hooks/src/reasoningbank/index.ts` | 80+ | Pattern learning, HNSW search |
| hooks | `v3/@claude-flow/hooks/src/daemons/index.ts` | 60+ | Daemon lifecycle, restart logic |
| neural | `v3/@claude-flow/neural/src/sona-integration.ts` | 60+ | SONA engine wrapper, adaptation |
| embeddings | `v3/@claude-flow/embeddings/src/embedding-service.ts` | 60+ | Provider abstraction, LRU cache |
| plugins | `v3/@claude-flow/plugins/src/core/plugin-interface.ts` | 60+ | Plugin contract definition |
| plugins | `v3/@claude-flow/plugins/src/registry/dependency-graph.ts` | 60+ | Custom semver, topological sort |
