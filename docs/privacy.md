# Privacy and security behavior

Applies to the audited OPC Timeline 1.7.1-beta.1 source, 2026-10-25. This is a description of implementation, not a guarantee about third-party services.

## Permissions

| Manifest permission | Actual purpose and boundary |
| --- | --- |
| `activeTab` | Temporary access following the user's toolbar action on the selected source tab. Capture rejects unsupported origins. |
| `scripting` | Inject the capture function into that selected ChatGPT page. |
| `sidePanel` | Show the extension alongside the source page. |
| `storage` | Local UI state and session capture binding. Content is primarily in IndexedDB. |
| `unlimitedStorage` | Support substantial local conversation/model data; this is not cloud storage or a backup guarantee. |

The manifest has no `host_permissions`, persistent `content_scripts`, `cookies`, `history`, `downloads` or `tabs` permission. This does **not** mean the extension has no networking or cannot access website session information through the explicitly authorized page. CSP allows self, loopback port 8787 and listed Hugging Face model-data hosts. JavaScript and WASM runtime files are packaged locally.

Chrome documents the temporary selected-tab grant in [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) and the panel permission in [Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

## Capture and import

Capture runs only after user action. `adapters/conversation-data.js` makes same-origin GET requests to the selected ChatGPT origin, including `/api/auth/session` and `/backend-api/conversation/...` or the share equivalent. For signed-in conversations it temporarily reads a session access token and an account cookie in the page, uses them as request headers, checks that the source has not changed and returns a whitelisted conversation graph. Credentials/headers/cookies are not intentionally returned to the extension database. There is no browser cookies API permission. This is an unofficial website interface and may break.

JSON import reads a user-selected file and offers a preview. Stored records can include question/answer text, source titles/URLs/IDs, timestamps, branch structure, attachment/citation references, tags, notes and relationships. Imports and exports are not anonymized. Attachment references do not mean attachment bytes were captured.

## Local storage and backups

Main content uses IndexedDB `ai-conversation-visual-navigator` v9. Derived embeddings/runs/reviews use `opc-knowledge-engine-v1`; versioned conversation analyses use `opc-conversation-analyses-v1`. Model data use Cache Storage. UI restore state/drafts use extension local storage and capture binding uses session storage. No cloud sync or telemetry pipeline was found in this extension's code.

The application does not encrypt these databases or export files. Anyone with access to the browser profile or exported file may obtain its content. Browser storage clearing, profile removal or extension uninstall can remove local records.

Export the project/library backup **and**, when used, the knowledge-analysis backup from the knowledge view. The standard backup does not cover all independent analysis history and derived caches. Knowledge import may preserve/merge versions for review rather than overwrite the current record. Derived caches/models may need regeneration or reimport. Exported JSON/Markdown/HTML/DOCX, clipboard copies and print/PDF output may contain full private conversation text. Keep them outside public source control. Project deletion is not a claim of secure erasure from files, prior backups or third-party systems.

## Network destinations

| Trigger | Destination | Data sent |
| --- | --- | --- |
| Explicit website capture | Current approved ChatGPT origin | Authenticated same-origin reads of the selected conversation; session stays on that website |
| Opt-in semantic model setup | Hugging Face and allowed model-data/CDN hosts | Model download requests and normal network metadata; no conversation-upload path was found in this BGE flow |
| Manual offline model import | Local file → Cache Storage | No model download is needed for this import; fixed size and SHA-256 are checked |
| Connect/estimate optional AI | `http://127.0.0.1:8787` | Pairing token, selected documents and analysis options for the estimate; not yet an OpenAI request |
| Final **Confirm send and analyze** | Loopback proxy → `https://api.openai.com/v1/responses` | Selected conversation's original Q/A text, evidence IDs/ranges and analysis instructions; large inputs can cause multiple calls |

The proxy requires an exact extension Origin, validates Host/Origin and a pairing token, and listens on `127.0.0.1`. API keys come from the proxy environment; do not enter them into the extension. The extension keeps the pairing token only in page memory. The proxy prints a pairing token at startup; do not publish that terminal output. Requests use `store: false`, but that flag is not a promise of zero retention by OpenAI. The proxy has no intentional conversation-body disk logging; it temporarily caches analysis results in memory. Provider account policies and usage charges still apply.

No live paid API call was made for this preparation. Mock integration results do not establish provider availability, current pricing or semantic accuracy. Cancel can stop further work but may not retract a request already processed or billed. Network/CSP support does not grant a missing browser permission automatically; actual connection behavior needs browser acceptance.

## Diagnostics and reports

Default capture diagnostics use an allowlist of structural counts and errors. Optional diagnostic additions and the on-demand live probe can expose IDs, file paths, view state or geometry; review them before sharing. Test profiles use synthetic data. Never attach a real browser profile, authentication response, HAR file, full chat backup or unreviewed screenshot to a public issue.
