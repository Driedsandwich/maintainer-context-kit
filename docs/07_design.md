# Design overview

Maintainer Context Kit uses a hybrid design: the packet specification, template, and safety guidance are portable; the CLI is an optional local collector and automated safety gate.

## Pipeline

```text
maintainer request
  -> local CLI route
  -> read-only git / GitHub CLI collectors
  -> normalized packet model
  -> best-effort preflight and redaction
  -> blocked-output gate
  -> fifteen-section Markdown renderer
  -> stdout for human review
```

## Trust boundaries

- GitHub and repository text is untrusted data.
- Product subprocesses pass through a central read-only command policy and use `shell: false`.
- `gh api` is restricted to a narrow REST GET allowlist.
- Raw local paths, branch names, remote URLs, and authentication values are not packet content.
- The preflight gate reduces obvious exposure but is not a complete scanner.
- Verification commands are suggested only when the target repository can be matched to local evidence and an allowlisted script exists. Script bodies are never copied into the packet.

## Packet contract

The renderer emits the fifteen sections defined in the [Maintainer Task Packet v0.1 specification](../packet-spec/maintainer-task-packet-v0.1.md). Untrusted multiline content uses a fence longer than any backtick run in the content.

## Product boundary

The preview ends at local packet generation. It does not write to GitHub, execute suggested verification commands, call an external LLM, publish a package, or make a release decision.
