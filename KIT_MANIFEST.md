# SpankNSave benchmark kit

Apply this archive at the root of the SpankNSave repository, then follow `BENCHMARK_EXECUTION_GUIDE.md`.

Validated against the uploaded SpankNSave archive with Node.js 22.16.0:

- `npm run check`: 109 tests passed
- `npm run build`: passed
- `npm run benchmark:local`: passed
- fixture generators: 500 detector fixtures and 300 token-calibration samples
- token-calibration analyzer: control-data validation passed
- versioned publisher and SHA-256 manifest generation: validation passed
- clean-repository kit application: passed

Provider token-count API calls and live OpenCode model runs require the user's credentials and were not executed during kit validation.
