# Contributing

OPC Timeline is the primary extension; the earlier Python prototype remains in this repository.

1. Keep imported conversation data local and never commit personal exports, API keys or generated databases.
2. Reproduce behavior changes with meaningful tests; documentation-only changes need link/review checks.
3. Preserve source IDs and evidence coordinates through every transformation.
4. Clearly separate source-derived claims from model-generated extensions.
5. From `apps/navigator-extension`, run `npm test`, `npm run build` and `npm run verify:package`. Follow `docs/testing.md` for native browser tests. For Python changes, also run `python -m unittest discover -s tests -v` at the repository root.

Small connector fixtures must be synthetic and contain no real personal information.
