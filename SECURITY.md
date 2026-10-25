# Security Policy

OPC Timeline's core data live in the local browser. The optional Node AI proxy is paired/authenticated and binds only to loopback; the separate legacy Python prototype has different local API boundaries. Do not expose either local development service to the internet.

Never attach chat exports, databases, cookies, API keys, pairing tokens, HAR files or browser profiles to public issues. Use synthetic reproductions and review diagnostics/screenshots before sharing. See [privacy](docs/privacy.md) and the [release audit](docs/security-audit.md).

Before publication the maintainer must enable GitHub private vulnerability reporting or provide a verified private contact. Once configured, report data-exposure vulnerabilities through that channel, not a public issue. No private contact or response-time commitment is invented here. No published supported-version/security-fix policy exists yet; this candidate is a local Beta preparation.
