# Updating the Pixels Core submodule

Pixels is developed as the `third_party/pixels` Git submodule in this repository. A separate sibling checkout is never a build input.

1. Enter `third_party/pixels`, create or select the intended Core branch, make the C++ change there, and run the Core native and WASM tests.
2. Commit and push the Core change. The parent repository may only pin a commit that is reachable from the configured submodule remote.
3. Update `coreCommit` in `scripts/lib/core-config.mjs`.
4. From the parent repository root, run:

   ```sh
   PIXELS_EMCMAKE=/path/to/emsdk/upstream/emscripten/emcmake npm run build:core
   npm run stage:core
   git add third_party/pixels resources/core scripts/lib/core-config.mjs
   npm run verify:core
   npm run check
   ```

5. Build once from a different absolute source directory and compare the WASM SHA-256. The Core build applies a source-prefix map so developer paths cannot affect or leak into the artifact.
6. Review the parent gitlink, generated manifest, ABI version, artifact size, dependency/import scans, and package audit together.

The build and verifier reject a wrong or dirty submodule. Never patch generated WASM or copy an artifact from another checkout. If the ABI contract changes, update both sides deliberately and add mismatch coverage before staging it.

## Synchronizing upstream

Fetch the canonical `pixelsdb/pixels` master into the existing `third_party/pixels` checkout and merge its exact commit into `feat/pixels-inspector-wasm-core`. Do not replace the feature branch with upstream master: it contains the portable Reader and inspector adaptations. Review writer byte layouts and reader semantics even when Git reports no conflicts; unchanged `pixels.proto` does not guarantee unchanged V1 payload layouts. Run the native sanitizer matrix and the generated compatibility corpus through the exact rebuilt WASM and real Workers before updating the parent pin. Push the integrated Core branch before committing or publishing a parent pin that other clones must resolve.

The synchronization through upstream `ee79284de7b41f9ddbfd52b03cae5687d10673c4` preserves the portable ABI 4 and inactive compression contract. Current plain SHORT uses two-byte signed values; historical V1 writers used four bytes. The reader checks full pixel physical counts and byte spans, accounts for final null-bitmap alignment, and uses consistent earlier-pixel evidence when reading an aligned final pixel. Compacted nulls require exact bitmap counts; padded nulls retain their scalar slots. An all-null compacted pixel requires no scalar width. A single-pixel chunk whose alignment makes both widths equally possible cannot be identified reliably because V1 has no layout-version marker; it fails explicitly as unsupported rather than returning guessed values. Invalid or inconsistent spans are malformed input.

Current BINARY and VARBINARY writers use concatenated non-null payloads followed by null bitmaps, a starts table, and a trailer. The reader distinguishes this layout structurally from historical length-prefixed binary chunks and uses the shared bounded variable-length decoder. Empty payloads remain distinct from SQL NULL, arbitrary bytes are returned as base64 without UTF-8 validation, and schema maximum lengths remain enforced. TIME's new picosecond Java vector is a reader-side conversion; the file continues to store millisecond INT32 values. Java module additions, including metadata database connectors, are not dependencies of the portable target or extension package.

Final RLE and legacy binary pixels may contain zero-filled alignment padding before the null bitmap. Accept it only when the padding length exactly matches rounding the decoded prefix up to the declared alignment boundary; arbitrary trailing bytes remain invalid. Current binary starts tables must begin after the complete null bitmap, contain exactly one start per non-null value plus the terminal sentinel, and stay within actual content bounds. These validations also apply to all-null pages.

After rebuilding and staging, run the durable native-to-Worker gate for each compiler:

```sh
CC=gcc CXX=g++ node scripts/test-worker-corpus.mjs
CC=clang CXX=clang++ node scripts/test-worker-corpus.mjs
```

The gate builds and runs native sanitizer tests, verifies the staged Core pin, generates the corpus twice and compares every file, then executes all cases through real Node and Chromium Workers. Install the test browser with `npx playwright install chromium`, or supply `PIXELS_CHROMIUM_EXECUTABLE` for an installed compatible Chromium. Both compiler CI jobs require this gate; a skipped corpus test in the fast unit suite does not replace it.
