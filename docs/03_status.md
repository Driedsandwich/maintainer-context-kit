# Status

Last updated: 2026-07-30

## Current phase

Maintainer-controlled public OSS preview.

The portable center of the project is the Maintainer Task Packet specification, reusable template, and safety guidance. The CLI is an optional local collector and best-effort safety gate.

## Implemented

- repository handoff, Issue triage, and Pull Request review packets
- explicit source provenance for Issue and Pull Request packets
- local-first execution with no external LLM calls
- exact-argument allowlisting for the Git commands used by the product
- fail-closed validation for GitHub REST GET requests
- optional Git locks disabled for product Git subprocesses
- major variable-length GitHub fields—body, comments, reviews, and file summaries—bounded before JSON reaches the MCK Node process
- explicit comment and review selection coverage
- bounded excerpts, untrusted-content fencing, and best-effort preflight/redaction
- repository-aware npm verification suggestions without guessed commands
- public-safe synthetic demo commands

## Not implemented

- GitHub write operations
- complete secret or PII detection
- complete Issue, Pull Request, diff, comment, review-thread, or check-result capture
- GitHub Enterprise support
- direct import from GitHub Web Context Exporter
- stdin or shared runtime schema integration
- npm distribution, tags, releases, or a packaged installer
- production-readiness or community-maintenance guarantees

## Version interpretation

- `package.json` and CLI source version: `0.0.0`
- packet contract: Maintainer Task Packet `v0.1`

The packet contract version does not imply that an npm package or hosted release exists.

## Verification baseline

- automated test suite: 95 tests in this local candidate
- demo smoke commands: doctor, handoff, triage, and review
- workflow permissions: read-only `contents`
- GitHub Actions dependencies: full commit SHA pins with weekly update monitoring

Test and CI results apply only to the tested revision. They are not proof of production readiness or complete data-safety coverage.

## Relationship to GitHub Web Context Exporter

[GitHub Web Context Exporter](https://github.com/Driedsandwich/github-web-context-exporter) is a browser-side companion for visible-page capture. This project creates repository-aware packets from local Git and read-only GitHub CLI sources.

They are deliberately independent. Add an import path or common runtime schema only after repeated real workflows demonstrate that manual transfer is a material problem.

## Current maintenance decision

- keep both the portable packet materials and the optional CLI
- fix safety-boundary defects before feature expansion
- accept public-safe bug reports and documentation issues
- avoid feature, packaging, and integration expansion without measured user need
- treat historical private-iteration notes as evidence, not current policy
