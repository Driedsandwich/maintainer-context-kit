# Current usage

This source preview supports local use from a clone. It is not published as an npm package.

## Commands

```bash
npm test
npm run doctor:json
npm run handoff
npm run handoff:demo
npm run triage:demo
npm run review:demo
node src/cli.ts triage <issue-number-or-url>
node src/cli.ts review <pull-request-number-or-url>
node src/cli.ts --help
node src/cli.ts --version
```

`doctor` checks the local environment without printing raw local paths or branch names. `handoff`, `triage`, and `review` create bounded packets from read-only context. Demo commands use synthetic public-safe data.

Live commands require `gh` authentication and a repository context that matches the requested target. When a repository-specific verification command cannot be established from local evidence, the packet uses a general instruction to follow the repository's own documentation.

Always review generated output. A preflight pass does not mean the packet is safe to publish or share.
