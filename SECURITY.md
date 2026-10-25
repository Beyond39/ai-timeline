# Security Policy

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/Beyond39/ai-timeline/security/advisories/new). This repository enabled that channel during the public Beta finalization. Do not put private material in public Issues. Beta versions have no long-term support or response-time guarantee.

Never attach real chat exports, databases, Cookie/session values, API keys, pairing tokens, HAR files or browser profiles. Use synthetic reproductions and review diagnostics/screenshots before sharing. See [privacy](docs/privacy.md) and [release audit](docs/security-audit.md).

Core data are stored in the browser. The optional paired Node AI proxy binds to loopback only; the legacy Python prototype has separate local API boundaries. Do not expose either development service to the internet. If a credential is exposed, revoke or rotate it at the provider before considering history cleanup.
