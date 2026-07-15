# Project goal

Maintainer Context Kit helps a maintainer prepare one bounded decision packet from local repository and read-only GitHub context.

The project combines two portable layers:

1. a Markdown packet specification and reusable template;
2. an optional local CLI collector and automated best-effort safety gate.

The goal is not to automate maintainer decisions. It is to reduce repetitive collection and formatting while keeping untrusted source text, safety limits, non-goals, risks, and verification visible to the human reviewer.

Success means the packet is consistent, factually traceable, reviewable, and generated without GitHub writes or external LLM calls. A preflight pass is never proof that output is safe to share.
