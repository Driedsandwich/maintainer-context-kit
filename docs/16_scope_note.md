# Scope note

Date: 2026-07-03

> Historical evidence. This note records the private-iteration decision at the date above. It is not the current repository status or visibility policy. See [Current status](03_status.md).

## Status

This note confirms the current private-iteration scope after the review evidence recorded so far.

## Current commands

- `mck doctor`
- `mck handoff`
- `mck triage --demo`
- `mck triage <issue-number-or-url>`
- `mck review --demo`
- `mck review <pr-number-or-url>`

## Current scope

- Local-first command execution.
- Read-only GitHub context collection through guarded command paths.
- Markdown packet rendering for maintainer review.
- Best-effort preflight and redaction.
- Synthetic demo content for examples.
- Local clone / direct repository use for private iteration.

## Current non-goals

- No GitHub write actions.
- No external LLM API calls.
- No automatic issue updates, comments, reviews, or merges.
- No package distribution approval.
- No external install path approval.
- No repository visibility change.
- No tag or hosted release page.
- No external announcement.
- No full diff hunk rendering.
- No claim of complete secret or PII detection.
- No compliance, enterprise-security, password-manager, or secret-manager claim.

## Recorded evidence

- Project policy: `docs/10_license_decision_note.md`.
- Local command check: `docs/20_local_check_record_20260703.md`.
- README/current usage review: `docs/21_readme_usage_review_note.md`.
- Demo/sample text review: `docs/12_demo_text_review_note.md`.
- Package metadata review: `docs/13_metadata_review_note.md`.
- Install path decision: `docs/14_install_path_note.md`.
- Safety and limitation language review: `docs/15_safety_language_review_note.md`.

## Current decision

The current scope is coherent for private iteration.

This note does not approve package distribution, external announcement, repository visibility changes, tags, release pages, outside contributions, or external reuse.

## Follow-up

- Update `docs/11_private_iteration_checklist.md` after this confirmation is merged.
- Continue with maintainer decision recording using `docs/17_decision_record_template.md`.
