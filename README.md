# SpankNSave

SpankNSave is an OpenCode plugin that watches session telemetry, detects likely token overconsumption, and produces ranked, reviewable optimization patches.

It is designed to answer four questions:

1. **Where are tokens being consumed?**
2. **Is the consumption abnormal or wasteful?**
3. **What is the most probable cause?**
4. **What is the smallest low-risk patch likely to reduce it?**

SpankNSave does not call another language model to analyze every turn. Its initial detection pipeline is deterministic, local, and based on OpenCode events and provider-reported usage.

## Current status

This repository contains the initial `0.1.0` implementation. Use `suggest` mode until thresholds have been calibrated against real sessions. `enforce` mode is intentionally limited to reversible output controls.

## Why this is an OpenCode plugin

A watcher needs continuous access to session, message, model, tool, and compaction events. A skill is loaded on demand and cannot continuously observe sessions. An MCP server would expose tools, but those tool definitions would themselves add context overhead. SpankNSave therefore uses a native OpenCode plugin for collection and analysis.

## What it measures

### Authoritative fields

The following fields come directly from OpenCode/provider telemetry:

- Input tokens
- Output tokens
- Reasoning tokens
- Cache-read tokens
- Cache-write tokens
- Cost
- Provider and model identifiers
- Model context limit

### Estimated fields

OpenCode and model providers do not expose a complete causal token breakdown for every context component. SpankNSave therefore estimates:

- Latest user-prompt size
- Persistent/system instruction size
- Enabled tool-schema size
- Tool-output contribution
- Potential token savings

Every report explicitly distinguishes authoritative measurements from estimates.

## Detectors

SpankNSave currently detects:

- Context-window pressure
- Rapid context growth between turns
- Oversized user prompts
- Oversized persistent/system instructions
- Tool-definition and MCP schema bloat
- Oversized tool results
- Duplicate tool calls with identical normalized arguments
- High reasoning-token share
- Excessive assistant output
- Retry waste

See [Detection rules](docs/DETECTIONS.md) for thresholds, evidence, and patch behavior.

## Safety model

SpankNSave has three operating modes:

| Mode | Reports | TUI notifications | Mutates model/tool output |
|---|---:|---:|---:|
| `observe` | Yes | No | No |
| `suggest` | Yes | Yes | No |
| `enforce` | Yes | Yes | Only configured output caps |

The default is `suggest`.

SpankNSave does **not** automatically rewrite `AGENTS.md`, skills, OpenCode configuration, application code, or MCP definitions. Those changes are emitted as reviewable patch proposals because token reduction must not silently degrade correctness.

## Privacy

Reports contain metrics, estimates, hashes, tool names, and patch recommendations. They do not persist raw user prompts, system instructions, tool arguments, or tool output. Report files are written with user-only permissions where the host filesystem supports them.

See [Privacy and threat model](docs/PRIVACY.md).

## Installation

### Development/source installation

Requirements:

- Node.js 22 or later for development
- OpenCode with plugin support
- npm for dependency installation and build

Clone and build:

```bash
git clone https://github.com/MerverliPy/SpankNSave.git
cd SpankNSave
npm ci
npm run check
npm run build
```

Install the built local plugin into an OpenCode project:

```bash
npm run install:local -- /absolute/path/to/your/project
```

This creates:

```text
<project>/.opencode/plugins/spank-n-save.js
<project>/.opencode/spank-n-save.json
```

Restart OpenCode after installation.

### Use this repository as an OpenCode project

The repository contains `.opencode/plugins/spank-n-save.ts`, a development loader that imports the source implementation directly. OpenCode will load it automatically when opened in this repository.

### npm installation

The package metadata is prepared for npm distribution, but this README does not claim that a registry release exists. After an authorized release is published, it can be added to `opencode.json` as an npm plugin:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["spank-n-save"]
}
```

Do not configure both the local plugin and the npm package at the same time; OpenCode would load both.

## Configuration

Create `.opencode/spank-n-save.json` in the monitored project:

```json
{
  "$schema": "https://raw.githubusercontent.com/MerverliPy/SpankNSave/main/schemas/spank-n-save.schema.json",
  "mode": "suggest",
  "warningContextRatio": 0.7,
  "criticalContextRatio": 0.85,
  "maxToolOutputTokens": 6000,
  "maxPromptTokens": 4000,
  "maxSystemTokens": 8000,
  "maxToolSchemaTokens": 5000,
  "maxReasoningRatio": 0.55,
  "minReasoningTokens": 4000,
  "maxAssistantOutputTokens": 8000,
  "maxContextGrowthTokensPerTurn": 12000,
  "duplicateToolCallThreshold": 2,
  "reportDirectory": ".opencode/spank-n-save/reports",
  "maxReports": 100,
  "toastCooldownMs": 30000
}
```

Invalid numeric values are clamped to safe ranges. Unknown modes fall back to `suggest`. A legacy `.opencode/token-guard.json` file is read for migration compatibility, but new configuration should use `.opencode/spank-n-save.json`.

See [Configuration reference](docs/CONFIGURATION.md).

## Reports

Reports are written when a session becomes idle and when the plugin is disposed:

```text
.opencode/spank-n-save/reports/<session-id>.json
```

A report contains:

- Schema and plugin versions
- Measurement policy
- Session summary
- Ranked findings
- Confidence and risk classifications
- Evidence
- Estimated savings
- A proposed target and change
- Whether a patch is safely auto-applicable

See [example report](examples/report.example.json).

## Enforce mode

Enforce mode can:

1. Cap `maxOutputTokens` when explicitly configured.
2. Truncate oversized tool output using a head-and-tail strategy.

The middle is removed because command failures and summaries commonly appear at the end of output. Tool enforcement can be restricted:

```json
{
  "mode": "enforce",
  "maxToolOutputTokens": 6000,
  "maxOutputTokens": 8000,
  "enforcementToolAllowlist": ["bash", "grep"],
  "enforcementToolDenylist": ["read"]
}
```

The denylist takes precedence over the allowlist.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The analysis engine is kept separate from the OpenCode adapter so detection behavior can be tested without starting an OpenCode session.

## Architecture

```text
OpenCode hooks/events
        │
        ▼
Telemetry normalization
        │
        ▼
Deterministic detectors
        │
        ▼
Priority scoring
(severity × confidence + savings − risk)
        │
        ▼
JSON report + TUI recommendation
        │
        ▼
Optional reversible enforcement
```

See [Architecture](docs/ARCHITECTURE.md).

## Project documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Detection rules](docs/DETECTIONS.md)
- [Privacy and threat model](docs/PRIVACY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Roadmap](docs/ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
