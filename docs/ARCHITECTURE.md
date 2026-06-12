# Architecture

## Design goals

SpankNSave is designed around five constraints:

1. Collection must add negligible model-context overhead.
2. Provider-reported usage must remain distinct from estimates.
3. Analysis must not require an additional LLM call for every turn.
4. Recommendations must identify evidence, expected savings, and risk.
5. Enforcement must be narrow, reversible, and opt-in.

## Components

### OpenCode adapter

`src/plugin.ts` subscribes to OpenCode hooks and events:

- `chat.message`
- `chat.params`
- `experimental.chat.system.transform`
- `tool.definition`
- `tool.execute.after`
- Message, session, retry, diff, compaction, and idle events

It normalizes external message objects into small internal records. Raw prompt and tool-result text is not retained after estimation.

### Configuration

`src/config.ts` loads `.opencode/spank-n-save.json`, validates modes and collection options, clamps unsafe values, and supports the legacy `.opencode/token-guard.json` path.

### Estimation utilities

`src/estimation.ts` implements:

- Configurable character-to-token estimates
- Stable hashes for normalized tool arguments
- Safe report filenames
- Head-and-tail truncation

Character-based estimates are deliberately labeled as estimates. They are used for component attribution, not authoritative billing.

### Analysis engine

`src/analysis.ts` is a pure deterministic function. It accepts normalized session state, configuration, and estimated tool-schema size. It produces a versioned report with ranked findings.

The separation allows unit testing without OpenCode or a model provider.

### Reporting

`src/reporting.ts` performs atomic JSON writes and prunes old reports according to `maxReports`. Temporary files are renamed only after a complete write.

## Finding priority

Priority uses bounded components:

- Severity
- Confidence
- Log-scaled estimated savings
- Patch-risk penalty

This is not a proof of global optimality. It is a deterministic ranking intended to select the smallest likely high-value intervention from the available evidence.

## Data lifecycle

```text
Raw OpenCode event
  → extract numeric fields
  → estimate length where required
  → hash normalized arguments
  → discard raw content
  → retain session metrics in memory
  → write sanitized report on idle/dispose
```

## Failure isolation

- Logging failures do not interrupt OpenCode.
- TUI failures do not interrupt reporting.
- Report-write failures are logged and do not alter the active session.
- Enforcement is disabled unless `mode` is `enforce`.
