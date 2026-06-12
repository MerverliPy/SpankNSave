# AGENT_HANDOFF.md

## Mission

Repair the audited defects in `MerverliPy/SpankNSave`. This file is the authoritative execution plan and completion ledger. Update it during implementation; do not maintain status only in chat, commit messages, or external notes.

**Audit baseline:** `8ee6fcf801d311ac9882eb935383502652a15192`  
**Initial release decision:** **DO NOT PUBLISH**  
**Release gate:** npm publication is prohibited until every P1 task and the P1 validation gate are complete.

Before changing code, inspect current `main` and verify whether later commits changed any finding.

## Agent authority

The agent may autonomously complete Preflight, all P1 repairs, and P1 validation. After that, it must stop and request human review. Do not begin P2 or P3 without explicit approval.

## Status protocol

- `[ ]` Not started
- `[-]` In progress
- `[x]` Completed and validated
- `[!]` Blocked
- `[~]` Deferred by explicit human decision

For each task:

1. Change `[ ]` to `[-]` before editing.
2. Implement and validate the repair.
3. Change to `[x]` only when every acceptance criterion passes.
4. Replace `Not completed` with:

```text
Completed by: <agent>
Date: YYYY-MM-DD
Commit(s): <SHA or pending>
Files changed: <paths>
Validation: <commands and results>
Notes: <design decisions or limitations>
```

For `[!]`, record the exact blocker, evidence, impact, safest next action, and whether it keeps the release gate closed. Never erase earlier completion records.

---

# Phase 0 — Preflight

## [ ] PRE-01 — Revalidate current repository state

- Record current commit and changes since the audit baseline.
- Run existing install, typecheck, test, and build commands.
- Confirm current OpenCode plugin API and dependency versions.
- Check for a lockfile, report schema, coverage enforcement, and release workflow.
- Classify each finding as present, corrected, changed, or not reproducible.

**Acceptance:** Baseline and command results are recorded; no finding is dismissed without evidence.

**Completion:** Not completed.

---

# Phase 1 — P1 required repairs

## [ ] P1-01 — Make report pruning ownership-safe

**Problem:** `pruneReports()` can treat unrelated JSON files in a configured directory as reports and delete them.

**Repair:**

- Use an unmistakable report filename pattern and/or dedicated plugin-owned directory.
- Prune only positively identified SpankNSave reports.
- Determine age using timestamps or a filename format that guarantees chronological order.
- Ignore unrelated JSON, temporary files, directories, malformed files, and unsafe links.
- Prevent configuration from broadening deletion scope unexpectedly.
- Document retention behavior.

**Tests:** unrelated files preserved; oldest owned reports removed; malformed/temp entries ignored; boundary cases covered.

**Acceptance:** Pruning cannot delete arbitrary JSON files and is deterministic.

**Completion:** Not completed.

## [ ] P1-02 — Make initialization fail-safe

**Problem:** Malformed config or filesystem errors can escape initialization and interrupt plugin loading.

**Repair:**

- Add a top-level initialization safety boundary.
- Handle malformed/unreadable config and report-directory failures.
- Recover by disabling the plugin or using validated defaults in `observe` mode.
- Never recover into `enforce` mode.
- Keep reporting noncritical to the OpenCode session.
- Log sanitized, actionable diagnostics.

**Tests:** malformed/unreadable config; unwritable report directory; pruning/logging failure; recovery never enforces.

**Acceptance:** Failures do not interrupt the session or mutate model/tool output.

**Completion:** Not completed.

## [ ] P1-03 — Correct tool-schema attribution

**Problem:** One plugin-lifetime schema map is summed into every report, allowing stale and cross-session contamination.

**Repair:**

- Replace lifetime accumulation with the narrowest reliable request, generation, agent, or bounded epoch scope.
- Expire stale definitions and replace repeated tool definitions rather than duplicating them.
- Associate measurements with sessions where the OpenCode API permits.
- If exact attribution is impossible, label the metric as an upper-bound estimate and reduce confidence accordingly.

**Tests:** different tool sets do not contaminate each other where isolation is possible; stale entries expire; wording matches scope.

**Acceptance:** Reports no longer present plugin-lifetime accumulation as session-specific fact.

**Completion:** Not completed.

## [ ] P1-04 — Bound in-memory state

**Problem:** Session maps, assistant messages, and changed-file sets can remain in memory indefinitely.

**Repair:**

- Track last activity and add a maximum tracked-session count.
- Evict idle states after report persistence.
- Use deterministic LRU or equivalent eviction at the limit.
- Retain only assistant history needed by detectors.
- Bound changed-file tracking or store only the required count.
- Persist safely before eviction when appropriate.

**Tests:** session limit; idle/LRU eviction; persistence before eviction; sufficient history for context-growth analysis; state released on deletion.

**Acceptance:** Memory is bounded without corrupting reports or detectors.

**Completion:** Not completed.

## [ ] P1-05 — Correct licensing

**Repair:**

- Replace the one-line `LICENSE` with the complete MIT text using the correct holder and year.
- Add `"license": "MIT"` to `package.json`.
- Confirm the license is included by `npm pack --dry-run`.

**Acceptance:** Package metadata and packed contents provide the complete MIT grant and disclaimer.

**Completion:** Not completed.

## [ ] P1-06 — Make installs and CI reproducible

**Repair:**

- Generate and commit `package-lock.json`.
- Add an exact `packageManager` field.
- Change CI from `npm install` to `npm ci`.
- Update contributor instructions.
- Add dependency review/audit where supported.
- Pin GitHub Actions to immutable SHAs where practical; document exceptions.

**Tests:** clean `npm ci`; lockfile consistency; typecheck, tests, and build from the locked graph.

**Acceptance:** Clean builds resolve the committed dependency graph and fail on lockfile drift.

**Completion:** Not completed.

## [ ] P1-07 — Add complete regression coverage

Add positive, negative, and boundary tests for:

- `CONTEXT_PRESSURE`
- `RAPID_CONTEXT_GROWTH`
- `OVERSIZED_USER_PROMPT`
- `OVERSIZED_SYSTEM_CONTEXT`
- `TOOL_SCHEMA_BLOAT`
- `OVERSIZED_TOOL_OUTPUT`
- `DUPLICATE_TOOL_CALLS`
- `HIGH_REASONING_SHARE`
- `EXCESSIVE_ASSISTANT_OUTPUT`
- `RETRY_WASTE`
- Priority ordering and score boundaries
- Zero/partial message updates and message removal
- Idle, deletion, disposal, persistence, and eviction
- Config failure and safe fallback
- Enforcement allowlist/denylist behavior
- Report privacy and pruning ownership
- Repeated/concurrent persistence
- Output-truncation boundaries

Add coverage reporting and a justified CI threshold. Fixtures must contain no real prompts, credentials, proprietary source, or unsanitized reports.

**Acceptance:** Every finding has positive, negative, and boundary coverage; every P1 failure has a regression test; CI enforces coverage.

**Completion:** Not completed.

---

# Phase 2 — P1 validation and mandatory stop

## [ ] GATE-01 — Run the complete P1 validation suite

At minimum run:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Also run added coverage, schema, dependency, package, and platform checks. CI should cover Linux and Windows where supported, Node 22 and current stable Node, lockfile install, tests, build, coverage, schema validation, and package inspection.

When infrastructure cannot support a check, record why, the equivalent local validation, exact follow-up work, and whether the limitation keeps the release gate closed.

**Acceptance:** All P1 criteria pass; no P1 task remains open or blocked without explicit human risk acceptance; evidence is recorded.

**Completion:** Not completed.

## [ ] GATE-02 — Stop for human review

Record completed, blocked, and deferred P1 tasks; test/CI results; behavior changes; compatibility and migration risks; and whether npm publication remains prohibited. Then stop and request approval before P2/P3.

**Completion:** Not completed.

---

# Phase 3 — P2 required repairs after approval

## [ ] P2-01 — Guarantee configured tool-output caps

Remove the hidden minimum retained size or raise/document the accepted minimum so every valid configured cap is enforceable. Add minimum and boundary tests.

**Completion:** Not completed.

## [ ] P2-02 — Redesign priority scoring

Prevent score saturation; preserve meaningful severity, confidence, risk, and savings differences; add deterministic tie-breaking and tests.

**Completion:** Not completed.

## [ ] P2-03 — Align report contents and privacy claims

Decide whether sanitized provider/model identifiers and duplicate-group hashes belong in reports. Make types, fixtures, documentation, and schemas consistent.

**Completion:** Not completed.

## [ ] P2-04 — Inject report time

Remove direct clock access from `analyzeSession()`. Inject `generatedAt` or a clock so identical inputs can produce identical reports in tests.

**Completion:** Not completed.

## [ ] P2-05 — Correct prompt-size attribution

Account for relevant non-text message parts or rename the metric to state that it is text-only. Prefer request-level estimation after transformations where supported.

**Completion:** Not completed.

## [ ] P2-06 — Persist before session deletion

Write the final sanitized report before removing state on `session.deleted`, while preserving fail-open behavior.

**Completion:** Not completed.

## [ ] P2-07 — Align Node support and CI

Make runtime minimum, Node type definitions, package metadata, documentation, and CI matrix describe the same supported versions. Validate Windows filesystem behavior.

**Completion:** Not completed.

---

# Phase 4 — P3 optional improvements

## [ ] P3-01 — Bound the OpenCode peer dependency

Replace unbounded `>=1.17.4` with a tested compatibility range, unless current versioning requires a different documented policy.

**Completion:** Not completed.

## [ ] P3-02 — Add a report JSON Schema

Add a versioned report schema, validate fixtures in CI, and document schema migration policy.

**Completion:** Not completed.

## [ ] P3-03 — Correct README scoring documentation

Document the actual scoring algorithm or change implementation to match the documented design.

**Completion:** Not completed.

## [ ] P3-04 — Align runtime normalization and config schema

Harmonize limits, integer handling, cross-field constraints, and unknown properties. Log sanitized normalization diagnostics instead of silently correcting all invalid values.

**Completion:** Not completed.

---

# Phase 5 — Final validation and recommendation

## [ ] FINAL-01 — Run final validation

Validate reproducible install, typecheck, unit/integration tests, coverage, build, config/report schemas, package contents, dependencies, supported operating systems, supported Node versions, and privacy fixtures.

**Completion:** Not completed.

## [ ] FINAL-02 — Issue publish/no-publish recommendation

Choose exactly one:

- **PUBLISH** — All release gates pass with no unresolved blocker.
- **PUBLISH WITH ACCEPTED LIMITATIONS** — Only after explicit human acceptance of documented non-P1 limitations.
- **DO NOT PUBLISH** — Any P1 criterion fails, evidence is missing, validation is incomplete, or behavior remains unsafe.

Record current commit, package version, completed/unresolved tasks, commands and results, CI status, limitations, migrations, rollback concerns, and recommended version bump.

**Completion:** Not completed.

---

# Non-negotiable release gate

Do not publish, create a release tag, remove the `0.1.0` cautionary status, enable enforcement by default, mark tasks complete from inspection alone, or suppress failing tests to pass the gate.

**npm publication remains prohibited until P1-01 through P1-07 and GATE-01 are `[x]` with validation evidence.** A final publish/no-publish recommendation is still required afterward.

# Progress summary

- Current phase: Phase 0 — Preflight
- Current status: Not started
- Last updated: 2026-06-12
- P1 completed: 0 / 7
- P2 completed: 0 / 7
- P3 completed: 0 / 4
- Active blockers: None recorded
- npm publication gate: **CLOSED**
- Human approval required before P2/P3: **Yes**
- Current recommendation: **DO NOT PUBLISH**
