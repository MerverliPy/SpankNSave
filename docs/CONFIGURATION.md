# Configuration reference

Configuration is read from `.opencode/spank-n-save.json` in the monitored project.

## Core settings

| Setting | Default | Meaning |
|---|---:|---|
| `enabled` | `true` | Enables the plugin. |
| `mode` | `suggest` | `observe`, `suggest`, or `enforce`. |
| `notify` | `true` | Shows the highest-priority finding in the TUI outside observe mode. |
| `reportDirectory` | `.opencode/spank-n-save/reports` | Absolute path or project-relative report directory. |
| `maxReports` | `100` | Maximum retained JSON reports. Oldest files are removed first. |
| `toastCooldownMs` | `30000` | Minimum time between notifications for a session. |

## Detection thresholds

| Setting | Default | Meaning |
|---|---:|---|
| `warningContextRatio` | `0.70` | Context-window warning threshold. |
| `criticalContextRatio` | `0.85` | Critical context-window threshold. Cannot be below the warning threshold. |
| `maxToolOutputTokens` | `6000` | Estimated token budget for one tool result. |
| `maxPromptTokens` | `4000` | Estimated budget for the latest user prompt. |
| `maxSystemTokens` | `8000` | Estimated budget for persistent/system text. |
| `maxToolSchemaTokens` | `5000` | Estimated combined budget for enabled tool definitions. |
| `maxReasoningRatio` | `0.55` | Maximum reasoning share of generated tokens before a finding. |
| `minReasoningTokens` | `4000` | Minimum reasoning volume before ratio analysis is reported. |
| `maxAssistantOutputTokens` | `8000` | Output-volume detection threshold. |
| `maxContextGrowthTokensPerTurn` | `12000` | Maximum expected input growth between consecutive assistant turns. |
| `duplicateToolCallThreshold` | `2` | Number of identical normalized calls required for a duplicate finding. |

## Memory limits

| Setting | Default | Meaning |
|---|---:|---|
| `maxToolObservationsPerSession` | `1000` | Caps in-memory tool observations. Oldest entries are dropped. |

## Estimation controls

| Setting | Default | Meaning |
|---|---:|---|
| `charsPerTokenEstimate` | `4` | Character/token ratio used only for estimated components. |
| `truncationHeadRatio` | `0.7` | Fraction of retained tool output allocated to the beginning. The remainder retains the tail. |

## Enforcement controls

| Setting | Default | Meaning |
|---|---:|---|
| `maxOutputTokens` | unset | Caps model output only in enforce mode. |
| `enforcementToolAllowlist` | `[]` | When nonempty, only these tools may be truncated. |
| `enforcementToolDenylist` | `[]` | These tools are never truncated. Takes precedence. |

## Recommended rollout

1. Run `suggest` mode across representative sessions.
2. Review false positives and adjust thresholds.
3. Enable enforcement only for known noisy tools.
4. Set `maxOutputTokens` only after verifying required deliverables fit under the cap.
5. Continue reviewing reports after enforcement is enabled.

## Migration

SpankNSave reads `.opencode/token-guard.json` when the new configuration file is absent. Rename the file to `.opencode/spank-n-save.json`; the legacy path may be removed in a future major version.
