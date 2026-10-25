# OPC Timeline 1.7.1-beta.1 — installation and privacy

Numeric manifest version: 1.7.1. This is a developer-mode Beta, not a Chrome Web Store publication.

Extract this ZIP into a permanent directory. In Chrome extensions enable Developer mode → Load unpacked → select the directory containing `manifest.json` directly. Do not load a ZIP or double-click an HTML page. Existing users: back up first, keep your original loading directory and extension entry, reload and reopen pages; changing path/profile can change extension identity. No database migration is introduced by this preparation.

Create a Project, import a supported JSON conversation or capture the currently selected saved ChatGPT page, preview and save. Timeline supports zoom/pan and Q/A reading; Canvas supports relationships; Deploy assembles reusable context. Tags, notes, search, backups and document exports remain available.

## Privacy

`activeTab` + `scripting` authorize capture on the user-selected tab; `sidePanel` shows the UI; `storage`/`unlimitedStorage` support local records. No persistent host access or cookies API permission is requested. Capture does use the selected ChatGPT page's session token/account cookie internally for same-origin reads; those credentials are not intentionally returned as stored records. Captured text, names, source URLs and attachment metadata can still be private.

Main content is stored in IndexedDB. Knowledge cache and versioned analyses use separate IndexedDB databases; models use Cache Storage. Export library/project backup and separate knowledge backup. Not every cache is included. The application does not encrypt local storage or exported files. Uninstall/storage clearing may remove records.

Core analysis is offline. Optional BGE setup downloads model data from Hugging Face or imports a fixed-checksum local ONNX file. Optional AI sends selected original Q/A text via a paired local proxy to OpenAI after final confirmation; estimates already send documents to the local proxy. The proxy is not in this runtime ZIP: use `tools/opc-ai-proxy.mjs` from the full source checkout. API keys belong only in its environment; pairing tokens must stay private. `store:false` does not guarantee zero provider retention. Real paid AI and semantic quality have not been validated by this preparation.

## Acceptance before private use

Create independent Projects A/B/C with synthetic conversations. Verify +/− change actual node spacing, Q/A opens the right question/answer, rapid switches preserve scope, refresh/reopen retain content, and two windows can edit without losing each other's changes. Back up/restore into an isolated profile. Also verify signed-in capture, existing-profile upgrade, Word/WPS/PDF output and browser zoom manually. Passing isolated automated tests is not a guarantee about a previously failing private profile.

The source repository contains the detailed architecture, test commands, audit, release notes and Windows Git guide. Read [third-party notices](THIRD_PARTY_NOTICES.md). The existing MIT LICENSE and vendor notices are included; preserve them when redistributing.
