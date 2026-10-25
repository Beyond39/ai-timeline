# Actual application screenshots

Captured on 2026-10-25 by `scripts/test-workspace-sync-mv3.mjs --cdp-load`, loading the final numeric 1.7.1 installation directory in an isolated native Chrome profile. The suite creates explicitly synthetic records and observes real UI rendering; screenshots are not design mockups or private user conversations. They show the end-of-regression view, not a staged marketing dataset.

- [timeline-workspace.png](timeline-workspace.png): real full-page Workspace with synthetic conversation lanes. The name “Synthetic pointer …” comes from the interaction fixture.
- [native-sidepanel.png](native-sidepanel.png): actual native Chrome Side Panel page used in the cross-window suite, displaying a different synthetic Project.

Both images were visually inspected before copying from ignored build output. Browser account controls, private chats and credentials are absent. Code/data tests use test-only instrumentation, as described in `../testing.md`. Add future Reader/Canvas/Deploy images only after capturing the real product with reviewed synthetic content; do not imply unimplemented features.
