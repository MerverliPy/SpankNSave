# SpankNSave Benchmark Execution Guide

This guide produces the eight evidence categories required for defensible README claims:

1. detector macro-F1 and false-positive rate;
2. provider-calibrated token-estimation error;
3. P95 plugin latency and memory overhead;
4. paired actual token and cost reduction;
5. task-success preservation;
6. estimated-versus-actual savings accuracy;
7. privacy canary leakage results; and
8. raw, versioned benchmark evidence.

## 0. Rules for valid claims

- Keep the exact repository commit, OpenCode version, model, model variant, task set, runner, and date with every result.
- Never describe synthetic detector fixtures as real-world accuracy. They are deterministic conformance tests.
- Do not claim token savings unless pure baseline, prediction, and treatment runs use the same task, commit, model, permissions, timeout, and validation command.
- Task success is determined by the task's verification command, not by OpenCode exiting successfully.
- Publish sample sizes and uncertainty intervals with percentages.
- Review every file for secrets and proprietary paths before publication.

## 1. Prerequisites

Use Linux, macOS, or WSL2. The paired runner invokes `bash` and Git worktrees.

Required software:

- Git
- Node.js 22 or newer
- npm
- OpenCode CLI
- provider credentials for the model used in paired runs
- a real Git clone of SpankNSave

The ZIP archive is sufficient for deterministic local benchmarks, but paired runs require a `.git` directory. Use the actual clone for the complete package.

Verify the environment:

```bash
node --version
npm --version
git --version
opencode --version
opencode auth list
opencode models
```

Select one exact OpenCode model identifier from `opencode models`, for example:

```bash
export OPENCODE_MODEL='provider/model-id'
```

Do not substitute a display name. Use the exact `provider/model` identifier.

## 2. Install the benchmark kit

From the root of your real SpankNSave Git clone:

```bash
cd /absolute/path/to/SpankNSave

KIT=/absolute/path/to/SpankNSave-benchmark-kit.zip
TMP=$(mktemp -d)
unzip -q "$KIT" -d "$TMP"
cp -a "$TMP"/. .
rm -rf "$TMP"

npm ci
npm run check
npm run build
```

Review the installed changes:

```bash
git status --short
git diff -- package.json .gitignore .github/workflows/benchmarks.yml
git diff -- benchmark BENCHMARK_EXECUTION_GUIDE.md
```

Commit the harness before paired runs because each task starts from a pinned Git ref:

```bash
git add package.json .gitignore .github/workflows/benchmarks.yml benchmark BENCHMARK_EXECUTION_GUIDE.md
git commit -m 'Add reproducible benchmark suite'
```

## 3. Run the deterministic benchmark package

Clean prior ephemeral results and run the complete local suite:

```bash
rm -rf benchmark/results
mkdir -p benchmark/results
touch benchmark/results/.gitkeep

npm run benchmark:local
```

This command runs:

```bash
npm run benchmark:fixtures
npm run benchmark:detectors
npm run benchmark:performance
npm run benchmark:privacy
```

Inspect the generated reports:

```bash
cat benchmark/results/detector-accuracy.md
cat benchmark/results/performance.md
cat benchmark/results/privacy.md
```

Expected output files:

```text
benchmark/results/detector-accuracy.json
benchmark/results/detector-accuracy.md
benchmark/results/performance.json
benchmark/results/performance.md
benchmark/results/privacy.json
benchmark/results/privacy.md
```

### Permitted initial claim

You may report the synthetic fixture count, exact conformance result, local P95 latency, memory delta, and privacy-canary result, provided they are clearly labeled as synthetic or machine-specific.

Do not call `detector-accuracy.md` real-world accuracy. Its fixture generator deliberately tests known rule boundaries.

## 4. Produce real-world detector macro-F1 and false-positive rate

### 4.1 Collect representative sessions

Target at least 200 sessions across:

- at least five repositories;
- bug fixes, feature work, tests, refactors, CI repairs, and repository discovery;
- small, medium, and large sessions;
- sessions expected to contain no waste findings.

Run SpankNSave in `observe` or `suggest` mode. Retain the generated SpankNSave report for each session.

List sessions and export private review copies:

```bash
mkdir -p benchmark/private/session-exports benchmark/private/reports
opencode session list --format json > benchmark/private/session-list.json

SESSION_ID='replace-with-session-id'
opencode export "$SESSION_ID" --sanitize \
  > "benchmark/private/session-exports/${SESSION_ID}.json"
```

Copy the corresponding SpankNSave report into `benchmark/private/reports/`. Keep this directory private; it is excluded by `.gitignore`.

### 4.2 Label sessions independently

Use two reviewers. Each reviewer must inspect the sanitized session without seeing SpankNSave's findings. Using the detector definitions in `docs/DETECTIONS.md`, each reviewer marks the expected detector codes:

```text
CONTEXT_PRESSURE
RAPID_CONTEXT_GROWTH
OVERSIZED_USER_PROMPT
OVERSIZED_SYSTEM_CONTEXT
TOOL_SCHEMA_BLOAT
OVERSIZED_TOOL_OUTPUT
DUPLICATE_TOOL_CALLS
HIGH_REASONING_SHARE
EXCESSIVE_ASSISTANT_OUTPUT
RETRY_WASTE
```

Resolve disagreements using a documented adjudication pass.

Create the label file:

```bash
cp benchmark/human-labels.example.jsonl benchmark/private/human-labels.jsonl
```

Each JSONL line must use this shape:

```json
{"id":"session-001","reportPath":"benchmark/private/reports/spanknsave-session-001.json","expectedCodes":["OVERSIZED_TOOL_OUTPUT"],"reviewerCount":2,"adjudicated":true}
```

A clean session uses an empty array:

```json
{"id":"session-002","reportPath":"benchmark/private/reports/spanknsave-session-002.json","expectedCodes":[],"reviewerCount":2,"adjudicated":true}
```

### 4.3 Calculate human-labeled metrics

```bash
HUMAN_LABELS_FILE=benchmark/private/human-labels.jsonl \
  npm run benchmark:detectors:human

cat benchmark/results/detector-human-accuracy.md
```

This produces:

```text
benchmark/results/detector-human-accuracy.json
benchmark/results/detector-human-accuracy.md
```

Publish the human-labeled macro-F1 only when the sampling method, labeling rubric, reviewer count, and adjudication method are documented.

## 5. Calibrate token estimates against the exact provider/model

SpankNSave's default estimate is based on characters per token. Calibration must be run separately for every provider/model used in claims. Treat the provider's count endpoint as the model-specific reference count; some providers document that preflight counts can differ slightly from final request usage.

### 5.1 Generate and inspect the corpus

```bash
CALIBRATION_MAX_SAMPLES=300 npm run benchmark:calibration:corpus
wc -l benchmark/fixtures/calibration/corpus.jsonl
less benchmark/fixtures/calibration/corpus.jsonl
```

The corpus includes repository code, Markdown, JSON, configuration, logs, minified JSON, and multilingual text. Review it before sending any text to a provider endpoint.

### 5.2 Anthropic

```bash
export ANTHROPIC_API_KEY='replace-with-key'
export CALIBRATION_PROVIDER='anthropic'
export CALIBRATION_MODEL='exact-anthropic-model-id'
export CALIBRATION_DELAY_MS=100
npm run benchmark:calibration:collect
unset ANTHROPIC_API_KEY
```

### 5.3 Gemini

```bash
export GEMINI_API_KEY='replace-with-key'
export CALIBRATION_PROVIDER='gemini'
export CALIBRATION_MODEL='gemini-model-id'  # bare ID or models/<ID>
export CALIBRATION_DELAY_MS=100
npm run benchmark:calibration:collect
unset GEMINI_API_KEY
```

### 5.4 OpenAI

```bash
export OPENAI_API_KEY='replace-with-key'
export CALIBRATION_PROVIDER='openai'
export CALIBRATION_MODEL='exact-openai-model-id'
export CALIBRATION_DELAY_MS=100
npm run benchmark:calibration:collect
unset OPENAI_API_KEY
```

The collector writes incrementally and resumes completed sample IDs if interrupted.

### 5.5 Analyze calibration

After collecting one or more provider/model files:

```bash
npm run benchmark:calibration:analyze
cat benchmark/results/token-calibration.md
```

Publish, per model:

- sample count;
- default ratio;
- calibrated ratio;
- median absolute percentage error;
- P95 absolute percentage error;
- mean signed error; and
- underestimation rate.

Do not combine different model tokenizer families into one ratio.

## 6. Measure P95 latency and memory overhead correctly

The local script measures analysis latency, hook latency, report-write latency, and retained-state memory.

For a publishable run:

1. Use one pinned machine or dedicated runner.
2. Close unrelated workloads.
3. Record CPU, RAM, OS image, Node version, and commit SHA.
4. Run the benchmark five times.
5. Publish every raw run, not only the best run.

Example:

```bash
mkdir -p benchmark/results/performance-repetitions

for run in 1 2 3 4 5; do
  npm run benchmark:performance
  cp benchmark/results/performance.json \
    "benchmark/results/performance-repetitions/run-${run}.json"
  cp benchmark/results/performance.md \
    "benchmark/results/performance-repetitions/run-${run}.md"
done
```

Record machine metadata:

```bash
{
  date -u +'%Y-%m-%dT%H:%M:%SZ'
  git rev-parse HEAD
  node --version
  npm --version
  uname -a
  command -v lscpu >/dev/null && lscpu
  command -v free >/dev/null && free -h
} > benchmark/results/performance-environment.txt
```

Use the P95 values from a predetermined aggregation rule. A conservative README presentation is the median of the five run-level P95 values, with all five raw files linked.

Do not enforce microsecond-level regression thresholds on noisy shared GitHub-hosted runners.

## 7. Configure the three-arm OpenCode benchmark

This stage simultaneously measures:

- actual token reduction;
- provider cost reduction;
- wall-time change;
- task-success preservation;
- expected-finding recall; and
- estimated-versus-actual savings accuracy.

### 7.1 Verify the repository is a Git clone

```bash
test -e .git || { echo 'ERROR: paired runs require a Git clone'; exit 1; }
git status --short
```

Commit or stash unrelated changes. The benchmark itself creates disposable detached worktrees.

### 7.2 Create the task manifest

Start with the three seeded smoke-test tasks:

```bash
cp benchmark/paired/tasks.example.json benchmark/paired/tasks.json
```

Validate the JSON:

```bash
node -e "JSON.parse(require('node:fs').readFileSync('benchmark/paired/tasks.json','utf8')); console.log('tasks.json valid')"
```

Each task requires:

```json
{
  "id": "unique-task-id",
  "baseRef": "pinned-commit-or-tag",
  "setupCommand": "command that seeds or checks out the defect",
  "prepareCommand": "dependency preparation command",
  "prompt": "identical prompt for all three conditions",
  "verifyCommand": "objective correctness command",
  "timeoutSeconds": 1200,
  "treatmentMode": "enforce",
  "predictionConfig": {},
  "treatmentConfig": {},
  "expectedFindingCodes": [],
  "savingsFindingCodes": [
    "OVERSIZED_TOOL_OUTPUT",
    "EXCESSIVE_ASSISTANT_OUTPUT"
  ]
}
```

For publishable evidence, replace `HEAD` with immutable commit SHAs or tags:

```bash
BASE_SHA=$(git rev-parse HEAD)
python - "$BASE_SHA" <<'PY'
import json, pathlib, sys
path = pathlib.Path('benchmark/paired/tasks.json')
data = json.loads(path.read_text())
for task in data:
    if task.get('baseRef') == 'HEAD':
        task['baseRef'] = sys.argv[1]
path.write_text(json.dumps(data, indent=2) + '\n')
PY
```

Commit the task manifest before execution:

```bash
git add benchmark/paired/tasks.json
git commit -m 'Define paired benchmark task set v1'
```

### 7.3 Run a low-cost smoke test

```bash
export TARGET_REPO="$PWD"
export OPENCODE_MODEL='provider/model-id'
export PAIRED_REPETITIONS=1
export PAIRED_RUN_ID="smoke-$(date -u +%Y%m%dT%H%M%SZ)"

npm run benchmark:paired:run

RAW_FILE=$(ls -1 benchmark/results/paired-runs-smoke-*.jsonl | tail -n 1)
PAIRED_RESULTS_FILE="$RAW_FILE" npm run benchmark:paired:summarize
cat benchmark/results/paired-summary.md
```

The runner uses three isolated conditions and rotates their order:

- **pure baseline:** OpenCode with `--pure` and no external plugins;
- **prediction:** SpankNSave in `observe` mode, used to record pre-intervention findings and estimated savings;
- **treatment:** SpankNSave in the task's configured treatment mode, normally `enforce`;
- creates a new detached Git worktree for every condition and repetition;
- installs SpankNSave only in the prediction and treatment worktrees;
- isolates OpenCode configuration;
- disables default plugins and auto-update checks;
- parses raw JSON step-finish events for tokens and cost;
- runs the task's objective verification command; and
- stores aggregate metrics, not raw model output.

It uses `--dangerously-skip-permissions` only inside disposable worktrees. Review the permission policy in `benchmark/paired/run.ts` before executing untrusted tasks.

### 7.4 Run the publishable experiment

The three example tasks are a harness validation, not a broad effectiveness study. Create at least 20 representative tasks and run five repetitions per condition for an initial public result. With three conditions, that is 300 OpenCode runs: `20 tasks × 5 repetitions × 3 conditions`.

```bash
export TARGET_REPO="$PWD"
export OPENCODE_MODEL='provider/model-id'
export OPENCODE_VARIANT='exact-variant-if-used'
export PAIRED_REPETITIONS=5
export PAIRED_RUN_ID="v1-$(date -u +%Y%m%d)-model-slug"

npm run benchmark:paired:run

export PAIRED_RESULTS_FILE="benchmark/results/paired-runs-${PAIRED_RUN_ID}.jsonl"
npm run benchmark:paired:summarize
cat benchmark/results/paired-summary.md
```

Omit `OPENCODE_VARIANT` entirely when the provider/model has no selected variant:

```bash
unset OPENCODE_VARIANT
```

### 7.5 Interpret correctness and efficiency together

The three-arm summary reports:

- pure-baseline and treatment success rates with Wilson intervals;
- success-rate difference in percentage points;
- an exact paired discordance test;
- median token, cost, and wall-time reductions with bootstrap intervals;
- token reduction among pairs where both pure baseline and treatment pass;
- diagnostic prediction-versus-pure overhead;
- estimated-versus-actual savings error and correlation, comparing prediction with treatment only for the codes named in `savingsFindingCodes`; and
- expected-finding recall from the prediction arm when tasks declare `expectedFindingCodes`.

Do not claim savings from failed treatment runs without showing task-success results beside them. The most defensible efficiency value is the pure-baseline-to-treatment reduction among pairs where both conditions passed validation. Treat prediction-arm estimates as calibrated only when `savingsFindingCodes` names the findings whose intervention is actually enabled in treatment.

## 8. Run the privacy leakage benchmark at publication scale

The default command injects unique canaries into prompts, system text, tool descriptions, schemas, arguments, outputs, message IDs, provider IDs, and model IDs, then scans persisted reports.

Run the default suite:

```bash
npm run benchmark:privacy
cat benchmark/results/privacy.md
```

Run a larger publication suite:

```bash
PRIVACY_SESSION_COUNT=500 npm run benchmark:privacy
cat benchmark/results/privacy.md
```

A valid zero-leak claim must state:

- number of sessions;
- total canaries injected;
- number of report files scanned;
- detected leak count; and
- permission-check failures.

A zero result does not prove absence of every possible privacy defect. Describe it as a regression-suite result.

## 9. Publish raw, versioned benchmark evidence

Choose a version identifier containing the benchmark suite version or date:

```bash
export BENCHMARK_VERSION="v1-$(date -u +%Y-%m-%d)"
npm run benchmark:publish
```

The command creates:

```text
benchmark/published/<version>/
├── inputs/
├── results/
├── manifest.json
└── metadata.json
```

`manifest.json` contains SHA-256 hashes and byte sizes. `metadata.json` records the repository commit, Node/npm/OpenCode versions, platform, architecture, and dirty-tree status.

Inspect before committing:

```bash
find "benchmark/published/$BENCHMARK_VERSION" -type f -maxdepth 6 -print
cat "benchmark/published/$BENCHMARK_VERSION/metadata.json"
cat "benchmark/published/$BENCHMARK_VERSION/manifest.json"

grep -RInE 'api[_-]?key|authorization|bearer |secret|token=' \
  "benchmark/published/$BENCHMARK_VERSION" || true
```

Commit and tag the immutable snapshot:

```bash
git add "benchmark/published/$BENCHMARK_VERSION"
git commit -m "Publish benchmark results $BENCHMARK_VERSION"
git tag -a "benchmark-$BENCHMARK_VERSION" \
  -m "SpankNSave benchmark $BENCHMARK_VERSION"
git push origin HEAD
git push origin "benchmark-$BENCHMARK_VERSION"
```

## 10. Enable GitHub Actions artifact collection

The kit adds `.github/workflows/benchmarks.yml`. It runs the deterministic suite on pull requests, pushes to `main`, and manual dispatches, then uploads `benchmark/results/` as an artifact.

Commit and push the workflow:

```bash
git add .github/workflows/benchmarks.yml
git commit -m 'Run deterministic benchmarks in CI'
git push origin HEAD
```

In GitHub:

1. Open the repository.
2. Select **Actions**.
3. Select **Benchmarks**.
4. Open the desired run.
5. Download `benchmark-results-<commit-sha>` from the Artifacts section.

CI artifacts are temporary evidence. The committed `benchmark/published/<version>/` snapshots are the permanent, reviewable record.

Do not run provider-funded paired benchmarks automatically on pull requests unless you add strict fork, secret, budget, and concurrency controls.

## 11. Add the README results section

Only insert values copied from a published snapshot. Use this template:

```markdown
## Validated performance

Benchmark snapshot: [`benchmark/published/<version>`](benchmark/published/<version>)  
Repository commit: `<sha>`  
OpenCode: `<version>`  
Model: `<provider/model>`  
Date: `<YYYY-MM-DD>`

| Metric | Result | Evidence |
|---|---:|---|
| Human-labeled detector macro-F1 | `<value>` | `<N>` independently labeled sessions |
| Clean-session false-positive rate | `<value>` | `<FP>/<clean N>`, 95% CI `<low–high>` |
| Token estimate median absolute error | `<value>` | `<provider/model>`, `<N>` samples |
| Token estimate P95 absolute error | `<value>` | `<provider/model>`, `<N>` samples |
| Analysis latency P95 | `<value>` | pinned runner, `<iterations>` |
| Tool-hook latency P95 | `<value>` | pinned runner, `<iterations>` |
| Median pure-to-treatment token reduction | `<value>` | `<N>` complete pure/treatment pairs |
| Median token reduction, both successful | `<value>` | `<N>` pure/treatment pairs where both passed |
| Task success-rate change | `<value> pp` | baseline `<x/N>`, treatment `<y/N>` |
| Savings-estimate median absolute error | `<value> tokens` | `<N>` estimates |
| Privacy canary leaks | `0/<canaries>` | `<reports>` reports scanned |
```

Directly below the table, disclose:

- task selection method;
- repetitions;
- confidence-interval method;
- timeout and failure treatment;
- model and variant;
- runner environment;
- known limitations; and
- link to raw JSON/JSONL.

## 12. Final release checklist

Run this before publishing any claim:

```bash
npm ci
npm run check
npm run build
npm run benchmark:local
npm run benchmark:calibration:analyze
PAIRED_RESULTS_FILE='benchmark/results/paired-runs-<run-id>.jsonl' \
  npm run benchmark:paired:summarize

git status --short
```

Confirm all items:

- [ ] synthetic detector results are labeled conformance, not real-world accuracy;
- [ ] human detector labels used at least two blinded reviewers;
- [ ] provider/model identifiers are exact and pinned;
- [ ] pure baseline, prediction, and treatment task inputs are identical;
- [ ] every task has an objective verification command;
- [ ] failed tasks are included in correctness statistics;
- [ ] confidence intervals and sample sizes are shown;
- [ ] performance runner details are recorded;
- [ ] raw JSON/JSONL and task definitions are published;
- [ ] published files were reviewed for sensitive data;
- [ ] metadata and SHA-256 manifest are present; and
- [ ] README claims exactly match the published snapshot.
