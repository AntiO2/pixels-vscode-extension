# Changelog

## 0.1.1

- Synced the portable Pixels Core with upstream `ee79284d` while preserving ABI 4.
- Added compatibility for current SHORT INT16 and legacy INT32 layouts, plus current BINARY/VARBINARY starts tables and legacy length-prefixed layouts.
- Fixed final-pixel alignment padding handling while enforcing strict null-bitmap, starts-table, and payload boundaries.
- Expanded the regression corpus to 99 cases across native, Node Worker, and Chromium Worker CI.

## 0.1.0

- Added a read-only Analyze workspace for navigating File, Row Group, Column Chunk, and Pixel segment structure.
- Added row- and column-oriented Data browsing with bounded paging, exact value rendering, and a projection cache.
- Added the Scan v2 Query builder with nested typed predicates, multi-column ordering, offset and limit, progress, cancellation, and cursor continuation.
- Added a portable ABI 4 Pixels Core compiled to WebAssembly for desktop, Remote, virtual workspace, browser, and untrusted workspace hosts.
- Added automatic Light, Dark, High Contrast, High Contrast Light, narrow-layout, keyboard, and Reduced Motion behavior.
- Added compatibility coverage for the declared encoding matrix, DECIMAL precision boundaries, TIMESTAMP precision and byte order, writer-timezone provenance, and inactive compression metadata.
