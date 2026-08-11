# Maintainer Context Kit

Maintainer Context Kit (`mck`) is a local-first, read-only tool for turning bounded GitHub and local repository context into structured Markdown Maintainer Task Packets.

This repository is a **maintainer-controlled OSS preview**. Its portable center is the packet specification, reusable template, and safety guidance. The CLI is an optional collector and automated best-effort safety gate.

## Preview scope

- Local execution only; no npm package is published.
- GitHub access is read-only.
- The product does not call an external LLM API.
- Packet preflight is best-effort and is not a complete secret or PII scanner.
- GitHub and repository text is untrusted data, not instructions to follow.
- Generated packets require human review before saving, uploading, or sharing.

This preview does not promise production readiness, community maintenance, tags, releases, or a package installation path.

## Requirements

- Node.js `24.12.0` or newer
- `git`
- [GitHub CLI](https://cli.github.com/) and an authenticated session for live GitHub collection
- A local clone of this source repository

No dependency installation is required.

## Verify the source

```bash
npm test
npm run doctor:json
npm run handoff:demo
npm run triage:demo
npm run review:demo
node src/cli.ts --help
node src/cli.ts --version
```

## Generate packets

```bash
# Inspect the current working repository
node /path/to/maintainer-context-kit/src/cli.ts handoff

# Public-safe synthetic examples
npm run handoff:demo
npm run triage:demo
npm run review:demo

# Read-only live collection
node src/cli.ts triage <issue-number-or-url>
node src/cli.ts review <pull-request-number-or-url>
```

Numeric issue and pull request targets use the current repository context. A full GitHub URL identifies the target explicitly.
Live triage and review packets validate the URL returned by GitHub CLI and render the source type, repository, number, and canonical GitHub URL. Missing or inconsistent provenance fails closed as a collection-failure packet instead of producing an attributed content packet.

## Safety model

`mck` centralizes subprocess execution behind a fail-closed policy. Local Git collection is restricted to the exact argument shapes used by the product, and GitHub REST access is restricted to validated GET requests. The runner disables optional Git locks, bounds GitHub fields before JSON reaches the MCK Node process, caps rendered excerpts, marks collected content as untrusted, applies best-effort preflight and redaction, and withholds packet stdout when a blocking finding is detected.

These controls reduce some obvious risks; they do not prove that a packet is safe to publish. Review every generated packet and use a dedicated secret scanner where appropriate.

## Project materials

- [Current status](docs/03_status.md)
- [Documentation index](docs/README.md)
- [Project goal](docs/00_goal.md)
- [v0.1 requirements](docs/01_requirements.md)
- [Local runbook](docs/02_runbook.md)
- [Design overview](docs/07_design.md)
- [Current usage](docs/08_current_usage_note.md)
- [Packet specification](packet-spec/maintainer-task-packet-v0.1.md)
- [Reusable packet template](templates/maintainer-task-packet.md)
- [Security policy](SECURITY.md)

## Browser-side companion

[GitHub Web Context Exporter](https://github.com/Driedsandwich/github-web-context-exporter) captures a bounded Markdown preview from the currently visible GitHub Issue or Pull Request conversation page. Maintainer Context Kit remains responsible for repository-aware handoff, triage, and review packets.

The two projects operate independently. There is no file import, stdin bridge, shared runtime schema, or automatic transfer between them.

## Issues and contributions

Public-safe bug reports and documentation issues are welcome through the supplied forms. Feature requests and outside code contributions are not accepted during the initial preview. See [CONTRIBUTING.md](CONTRIBUTING.md).

Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
