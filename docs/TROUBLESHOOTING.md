# Troubleshooting

## No reports are created

1. Confirm OpenCode loaded `.opencode/plugins/spank-n-save.js` or the npm plugin.
2. Confirm `enabled` is not `false`.
3. Let the session reach the idle state.
4. Check OpenCode logs for service `spank-n-save`.
5. Verify the report directory is writable.

## The plugin loads twice

Do not install both a local plugin file and the npm package. OpenCode loads local and npm plugins independently.

## A configuration value appears ignored

- Verify the filename is `.opencode/spank-n-save.json`.
- Invalid values are clamped or replaced with defaults.
- The legacy `.opencode/token-guard.json` path is used only when the new file is absent.
- Restart OpenCode after changing plugin installation or source files.

## Too many findings

Increase the relevant threshold after reviewing representative sessions. Do not raise every threshold globally; calibrate the detector producing false positives.

## Tool output is unexpectedly truncated

- Confirm `mode` is `enforce`.
- Add the tool to `enforcementToolDenylist`.
- Increase `maxToolOutputTokens`.
- Prefer a narrower tool query rather than a very high global limit.

## TUI notifications do not appear

Reports are the authoritative output. Notifications are suppressed in `observe` mode, during cooldown, or when the current OpenCode client does not expose the TUI toast interface.

## Context percentage is absent

The active model did not expose a context limit through the hook. Token counts are still reported, but context-window ratios cannot be calculated.
