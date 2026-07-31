# Updating the Pixels Core submodule

Pixels is developed as the `third_party/pixels` Git submodule in this repository. A separate sibling checkout is never a build input.

1. Enter `third_party/pixels`, create or select the intended Core branch, make
   the C++ change there, and run the Core native and WASM tests.
2. Commit and push the Core change. The parent repository may only pin a commit
   that is reachable from the configured submodule remote.
3. Update `coreCommit` in `scripts/lib/core-config.mjs`.
4. From the parent repository root, run:

   ```sh
   PIXELS_EMCMAKE=/path/to/emsdk/upstream/emscripten/emcmake npm run build:core
   npm run stage:core
   git add third_party/pixels resources/core scripts/lib/core-config.mjs
   npm run verify:core
   npm run check
   ```

5. Build once from a different absolute source directory and compare the WASM
   SHA-256. The Core build applies a source-prefix map so developer paths cannot
   affect or leak into the artifact.
6. Review the parent gitlink, generated manifest, ABI version, artifact size,
   dependency/import scans, and package audit together.

The build and verifier reject a wrong or dirty submodule. Never patch generated
WASM or copy an artifact from another checkout. If the ABI contract changes,
update both sides deliberately and add mismatch coverage before staging it.
