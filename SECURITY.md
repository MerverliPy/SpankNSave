# Security Policy

## Security Model

SpankNSave is a local OpenCode plugin with no network exposure. It:
- Runs entirely on the local filesystem
- Never sends data to remote services
- Never persists raw prompts, tool arguments, tool outputs, provider IDs, or model IDs
- Writes reports with 0600 permissions (user-only read/write)
- Uses SHA-256 for tool-argument deduplication hashes (in-memory only)

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

To report a security vulnerability, please contact the maintainer privately at the GitHub repository issues with a clear description. Do not file a public issue for security vulnerabilities.

## Disclosure Timeline

- Vulnerabilities will be acknowledged within 7 days
- A fix will be released within 30 days of acknowledgment
- Details will be published after the fix is released

## Scope

Security reports are welcome for:
- File path traversal vulnerabilities
- Information disclosure (credentials, prompts, tool data)
- Insecure file permissions
- Denial of service (memory exhaustion, crashes)
- Dependency vulnerabilities
