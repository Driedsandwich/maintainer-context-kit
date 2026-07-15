# Contributing

Maintainer Context Kit is currently a maintainer-controlled OSS preview.

## Accepted public input

- Public-safe bug reports
- Documentation issues

Use the repository Issue forms and remove private repository details, credentials, personal data, customer information, and raw packet output before submitting.

## Not accepted during the preview

- Feature requests
- Outside code contributions or pull requests
- Dependency or distribution proposals
- Requests for package publication, tags, releases, or production support

Unexpected outside pull requests may be closed without review. The included pull request template supports maintainer-controlled changes only.

## Security reports

Do not open a public Issue for a suspected vulnerability. Use the repository's private vulnerability reporting flow described in [SECURITY.md](SECURITY.md).

## Maintainer verification

Maintainer changes should keep the GitHub boundary read-only, use synthetic public-safe fixtures, avoid new dependencies unless separately approved, and run:

```bash
npm test
npm run doctor:json
npm run handoff:demo
npm run triage:demo
npm run review:demo
```

Passing these checks is not a release or publication decision.
