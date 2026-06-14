# Benchmark suite

See [`../BENCHMARK_EXECUTION_GUIDE.md`](../BENCHMARK_EXECUTION_GUIDE.md) for the complete execution and publication procedure.

## Commands

| Command | Purpose |
|---|---|
| `npm run benchmark:local` | Synthetic detector conformance, local performance, and privacy-canary suite |
| `npm run benchmark:detectors:human` | Compare reports with independently adjudicated human labels |
| `npm run benchmark:calibration:corpus` | Generate a representative text corpus |
| `npm run benchmark:calibration:collect` | Obtain exact provider/model token counts |
| `npm run benchmark:calibration:analyze` | Calculate estimation error and calibrated character ratio |
| `npm run benchmark:paired:run` | Run isolated pure-baseline/prediction/treatment OpenCode task triplets |
| `npm run benchmark:paired:summarize` | Calculate correctness, efficiency, and savings-calibration metrics |
| `npm run benchmark:publish` | Create an immutable versioned snapshot with metadata and SHA-256 manifest |

`benchmark/results/` is ephemeral and ignored except for `.gitkeep`. Permanent reviewed evidence belongs under `benchmark/published/<version>/`.
