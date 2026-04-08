# Local Development Configuration

## Environment Variables

```bash
CLAUDE_FLOW_CONFIG=./claude-flow.config.json
CLAUDE_FLOW_LOG_LEVEL=info
CLAUDE_FLOW_MEMORY_BACKEND=hybrid
CLAUDE_FLOW_MEMORY_PATH=./data/memory
CLAUDE_FLOW_MCP_PORT=3000
CLAUDE_FLOW_MCP_TRANSPORT=stdio
```

## Plugin Registry Maintenance (IPFS/Pinata)

Registry CID stored in: `v3/@claude-flow/cli/src/plugins/store/discovery.ts`
Gateway: `https://gateway.pinata.cloud/ipfs/{CID}`

Steps to add a plugin:
1. Fetch current registry: `curl -s "https://gateway.pinata.cloud/ipfs/$(grep LIVE_REGISTRY_CID v3/@claude-flow/cli/src/plugins/store/discovery.ts | cut -d"'" -f2)" > /tmp/registry.json`
2. Add plugin entry to `plugins` array, increment `totalPlugins`, update category counts
3. Upload: `curl -X POST "https://api.pinata.cloud/pinning/pinJSONToIPFS" -H "Authorization: Bearer $PINATA_JWT" -H "Content-Type: application/json" -d @/tmp/registry.json`
4. Update `LIVE_REGISTRY_CID` in discovery.ts and the `demoPluginRegistry` fallback

Security: NEVER hardcode API keys. Source from .env at runtime. NEVER commit .env.

## Doctor Health Checks

`npx claude-flow@v3alpha doctor` checks: Node 20+, npm 9+, git, config, daemon, memory DB, API keys, MCP servers, disk space, TypeScript.

## Hooks Quick Reference

```bash
npx claude-flow@v3alpha hooks pre-task --description "[task]"
npx claude-flow@v3alpha hooks post-task --task-id "[id]" --success true
npx claude-flow@v3alpha hooks session-start --session-id "[id]"
npx claude-flow@v3alpha hooks route --task "[task]"
npx claude-flow@v3alpha hooks worker list
```

## Intelligence System (RuVector)

4-step pipeline: RETRIEVE (HNSW) → JUDGE (verdicts) → DISTILL (LoRA) → CONSOLIDATE (EWC++)

Components: SONA (<0.05ms), MoE (8 experts), HNSW (150x-12,500x), Flash Attention (2.49x-7.47x)

## Publishing to npm

### Publishing Rules

- MUST publish ALL THREE packages when publishing CLI changes: `@claude-flow/cli`, `claude-flow`, AND `ruflo`
- MUST update ALL dist-tags for ALL THREE packages after publishing
- Publish order: `@claude-flow/cli` first, then `claude-flow` (umbrella), then `ruflo` (alias umbrella)
- MUST run verification for ALL THREE before telling user publishing is complete

```bash
# STEP 1: Build and publish CLI
cd v3/@claude-flow/cli
npm version 3.0.0-alpha.XXX --no-git-tag-version
npm run build
npm publish --tag alpha
npm dist-tag add @claude-flow/cli@3.0.0-alpha.XXX latest

# STEP 2: Publish claude-flow umbrella
cd /workspaces/claude-flow
npm version 3.0.0-alpha.XXX --no-git-tag-version
npm publish --tag v3alpha

# STEP 3: Update ALL claude-flow umbrella tags (CRITICAL - DON'T SKIP!)
npm dist-tag add claude-flow@3.0.0-alpha.XXX latest
npm dist-tag add claude-flow@3.0.0-alpha.XXX alpha

# STEP 4: Publish ruflo umbrella (CRITICAL - DON'T FORGET!)
cd /workspaces/claude-flow/ruflo
npm version 3.0.0-alpha.XXX --no-git-tag-version
npm publish --tag alpha
npm dist-tag add ruflo@3.0.0-alpha.XXX latest
```

**Verification (run before telling user):**
```bash
npm view @claude-flow/cli dist-tags --json
npm view claude-flow dist-tags --json
npm view ruflo dist-tags --json
# ALL THREE packages need: alpha AND latest pointing to newest version
```

### All Tags That Must Be Updated
| Package | Tag | Command Users Run |
|---------|-----|-------------------|
| `@claude-flow/cli` | `alpha` | `npx @claude-flow/cli@alpha` |
| `@claude-flow/cli` | `latest` | `npx @claude-flow/cli@latest` |
| `@claude-flow/cli` | `v3alpha` | `npx @claude-flow/cli@v3alpha` |
| `claude-flow` | `alpha` | `npx claude-flow@alpha` — EASY TO FORGET |
| `claude-flow` | `latest` | `npx claude-flow@latest` |
| `claude-flow` | `v3alpha` | `npx claude-flow@v3alpha` |
| `ruflo` | `alpha` | `npx ruflo@alpha` — EASY TO FORGET |
| `ruflo` | `latest` | `npx ruflo@latest` |

- Never forget the `ruflo` package — it's a thin wrapper users run via `npx ruflo@alpha`
- Never forget the umbrella `alpha` tag — users run `npx claude-flow@alpha`
- `ruflo` source is in `/ruflo/` — it depends on `@claude-flow/cli`

## Plugin Registry Operations

### Adding a New Plugin to Registry

1. **Fetch current registry**:
```bash
curl -s "https://gateway.pinata.cloud/ipfs/$(grep LIVE_REGISTRY_CID v3/@claude-flow/cli/src/plugins/store/discovery.ts | cut -d"'" -f2)" > /tmp/registry.json
```

2. **Add plugin entry** to the `plugins` array:
```json
{
  "id": "@claude-flow/your-plugin",
  "name": "@claude-flow/your-plugin",
  "displayName": "Your Plugin",
  "description": "Plugin description",
  "version": "1.0.0-alpha.1",
  "size": 100000,
  "checksum": "sha256:abc123",
  "author": {"id": "claude-flow-team", "displayName": "Claude Flow Team", "verified": true},
  "license": "MIT",
  "categories": ["official"],
  "tags": ["your", "tags"],
  "downloads": 0,
  "rating": 5,
  "lastUpdated": "2026-01-25T00:00:00.000Z",
  "minClaudeFlowVersion": "3.0.0",
  "type": "integration",
  "hooks": [],
  "commands": [],
  "permissions": ["memory"],
  "exports": ["YourExport"],
  "verified": true,
  "trustLevel": "official"
}
```

3. **Update counts and arrays**: Increment `totalPlugins`, add to `official`, update category `pluginCount`

4. **Upload to Pinata** (read credentials from .env):
```bash
PINATA_JWT=$(grep "^PINATA_API_JWT=" .env | cut -d'=' -f2-)
curl -X POST "https://api.pinata.cloud/pinning/pinJSONToIPFS" \
  -H "Authorization: Bearer $PINATA_JWT" \
  -H "Content-Type: application/json" \
  -d @/tmp/registry.json
```

5. **Update discovery.ts** with new CID and `demoPluginRegistry` fallback

### Security Rules
- NEVER hardcode API keys in scripts or source files
- NEVER commit .env (already in .gitignore)
- Always source credentials from environment at runtime
- Always delete temporary scripts after one-time uploads

### Verification
```bash
curl -s "https://gateway.pinata.cloud/ipfs/{NEW_CID}" | jq '.totalPlugins'
```
