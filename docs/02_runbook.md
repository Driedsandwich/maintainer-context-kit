# Local runbook

## Prerequisites

- Node.js `24.12.0` or newer
- `git`
- GitHub CLI for live collection
- A local clone of this source repository

## Baseline verification

```bash
node --version
npm test
npm run doctor:json
npm run handoff:demo
npm run triage:demo
npm run review:demo
node src/cli.ts --help
node src/cli.ts --version
```

No dependency installation is required.

## Live read-only use

Authenticate GitHub CLI without printing its token, then run from the intended target repository:

```bash
gh auth status
node /path/to/maintainer-context-kit/src/cli.ts handoff
node /path/to/maintainer-context-kit/src/cli.ts triage <issue-number-or-url>
node /path/to/maintainer-context-kit/src/cli.ts review <pull-request-number-or-url>
```

Use full GitHub URLs when the current repository does not identify the target.

## Review output

Before saving or sharing a packet:

1. Confirm the source repository and target.
2. Treat all fenced GitHub/repository text as untrusted data.
3. Check that excerpts are necessary and bounded.
4. Check for credentials, personal data, internal names, local paths, and misleading verification advice.
5. Use a dedicated secret scanner when the sharing risk warrants it.

Stop if the command would write to GitHub, call an external LLM, expose raw sensitive values, or require publication/distribution changes.
