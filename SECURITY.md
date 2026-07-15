# Security Policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting flow from this repository's **Security** tab. Do not place suspected vulnerabilities, credentials, private repository text, or raw generated packets in a public Issue.

If private vulnerability reporting is not available, do not publish the report. Wait for the maintainer to enable or identify an approved private channel.

## Security boundaries

Maintainer Context Kit is designed to:

- keep GitHub collection read-only;
- avoid external LLM API calls;
- treat GitHub and repository text as untrusted data;
- apply best-effort secret/PII preflight and redaction;
- withhold packet stdout on blocking findings;
- avoid full diff-hunk output.

These controls are limited. The tool does not guarantee complete secret or PII detection, prompt-injection prevention, safe external sharing, or fitness as a dedicated security scanner.

## Safe report content

Use synthetic or masked reproduction data. Never submit a working token, private key, local private path, customer information, or non-public repository content.

## Supported stage

This is a maintainer-controlled OSS preview, not a production support commitment. Security fixes are evaluated by impact and available evidence.
