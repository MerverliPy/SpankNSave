# Contributing

## Development setup

```bash
git clone https://github.com/MerverliPy/SpankNSave.git
cd SpankNSave
npm install
npm run check
npm run build
```

## Design requirements

Contributions should preserve these invariants:

- Provider-reported metrics remain distinct from estimates.
- Raw prompts, tool arguments, and tool output are not persisted.
- New detectors include evidence, confidence, risk, and a bounded recommendation.
- Enforcement remains opt-in and reversible.
- Detection logic remains testable without an OpenCode runtime.
- Plugin failures do not interrupt the active OpenCode session.

## Adding a detector

1. Add configuration only when the threshold cannot be derived safely.
2. Implement the rule in `src/analysis.ts`.
3. Include a stable finding code.
4. State whether evidence is authoritative or estimated.
5. Add unit tests for positive and negative cases.
6. Document the rule in `docs/DETECTIONS.md`.
7. Update the configuration schema when required.

## Pull requests

Keep pull requests focused. Include:

- Problem statement
- Measurement source
- False-positive considerations
- Security/privacy impact
- Tests
- Documentation changes

Do not include real prompts, credentials, proprietary source, or unsanitized session reports in fixtures.
