# Privacy and threat model

## Stored data

SpankNSave reports may contain:

- Session identifier
- Model/provider identifiers
- Token counts and cost
- Tool names
- Hashes of normalized tool arguments
- Counts, ratios, and estimates
- Patch recommendations
- Number of changed files

## Data not intentionally stored

SpankNSave does not persist:

- Raw user prompts
- Raw system instructions
- Raw tool arguments
- Raw tool output
- Source-file contents
- API keys or provider credentials

Tool arguments are represented by a truncated SHA-256 hash for duplicate detection. A hash is not encryption; low-entropy argument sets may still be guessable. Reports should remain local and access-controlled.

## Local processing

The deterministic analyzer does not send reports to an external service and does not invoke an additional language model.

## Filesystem protections

Reports are created with user-only permissions (`0600`) when supported. Directory permissions are inherited from the host environment. Users remain responsible for repository backups, sync services, and shared workstations.

## Enforcement risk

Tool-output and model-output caps can remove information required for correctness. Enforcement is disabled by default and must be calibrated in suggest mode first.

## Recommended controls

- Add the report directory to `.gitignore`.
- Do not publish reports without review.
- Keep configuration and reports outside shared repositories when session identifiers are sensitive.
- Use tool denylists for tools whose output must never be truncated.
