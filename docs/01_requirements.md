# v0.1 requirements

## Included

- `doctor`, `handoff`, `triage`, and `review` CLI routes
- Synthetic demo packets
- Local git and read-only GitHub CLI collection
- Fifteen-section Maintainer Task Packet rendering
- Untrusted-content boundaries and dynamic Markdown fences
- Best-effort preflight, redaction, and blocked-output withholding
- Repository-aware verification suggestions that only name statically verified scripts
- Tests using synthetic public-safe fixtures

## Required safety properties

- No GitHub write commands
- No shell-mediated subprocess execution
- No external LLM API calls
- No raw blocking fixture in output, errors, or finding excerpts
- No raw local path, branch name, remote URL, or authentication value in packets
- No claim of complete secret, PII, or prompt-injection protection
- Human review required before saving or sharing output

## Excluded

- GitHub comments, labels, edits, reviews, merges, releases, or settings changes
- Full repository packing or full diff-hunk output
- Package publication, tags, GitHub Releases, or production support promises
- Feature requests and outside contributions during the preview
- Automatic execution of verification commands
- A standalone `redact` command or release command
