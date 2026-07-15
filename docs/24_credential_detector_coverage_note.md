# Credential detector coverage note

Date: 2026-07-06

## Status

This is a design note for possible future preflight detector expansion. It does not add new detector code and does not approve any public release, package publication, or broader distribution.

## Current coverage

Current preflight coverage is intentionally best-effort. The implemented token-specific detectors separately identify legacy GitHub token prefixes and the fine-grained `github_pat_` family to avoid implying broad provider coverage.

The preflight result must continue to state that a pass result is not proof that a packet is safe to share publicly.

## Expansion problem

Adding more credential-like detectors can reduce obvious misses, but it also creates three risks:

- false confidence that the scanner is complete,
- false positives that make normal packets look unsafe,
- accidental documentation drift between detector names, labels, and implemented patterns.

## Acceptance criteria for adding a detector

A future detector should be added only when all of these are true:

1. The pattern is narrow enough to avoid frequent false positives in ordinary issue text.
2. The detector id and label name the exact provider or exact credential family when feasible.
3. The advice text avoids implying complete scanning.
4. Tests use synthetic placeholder values only.
5. Tests prove the raw placeholder value is not emitted in findings.
6. README and safety docs keep best-effort wording unchanged.

## Preferred detector naming

Use precise names such as:

- `github-token-like`
- `github-fine-grained-token-like`
- `credential-assignment-like`
- `<provider>-key-id-like`
- `<provider>-token-like`

Avoid generic names such as `provider-token-like` unless the implemented pattern truly covers multiple providers with comparable confidence.

## Candidate detector classes

Potential candidates for a later code PR:

| Candidate | Default severity | Notes |
| --- | --- | --- |
| Cloud access-key id-like values | warning or block | May identify only part of a credential pair; wording must be careful. |
| Common AI-provider token-like values | block | Add only with synthetic fixtures and provider-specific labels. |
| Package registry token-like values | block | Must avoid matching ordinary package names or URLs. |
| Chat/workspace app token-like values | block | Provider-specific labels required. |
| Generic assignment-like values | warning | Already covered in broad form; keep as warning due false-positive risk. |

## Non-goals

- Complete secret scanning.
- Compliance claims.
- Enterprise security claims.
- Replacement for dedicated scanners.
- Automatic approval for external sharing.

## Recommended next step

If detector expansion proceeds, create one small code PR for one detector family at a time. Each PR should include tests and avoid changing publication, release, or repository settings.
