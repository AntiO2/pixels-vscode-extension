# Pixels Inspector for VS Code

Pixels Inspector is a cross-platform VS Code extension for inspecting Pixels
files without adding a JVM or service runtime to the product. Parsing semantics
live in the portable C++ Pixels Core and are delivered to desktop, Remote, and
web extension hosts as WebAssembly.

Open a `.pxl` file to use the read-only custom editor. It provides:

- Overview — file, writer, shape, and portable-Core facts;
- Schema — the complete nested schema and column statistics;
- Row Groups — row-group summaries, encodings, chunks, and pixels;
- Data Preview — bounded paging with exact rendering/copying for all 20 kinds;
- Physical Layout — Schema → Row Group → Chunk → Pixel tracing.

The extension validates the pinned Core artifact, strict worker protocol, exact
range I/O, cancellation/recovery, and identical Node/browser execution.

## Repository layout

- `third_party/pixels/` — the exact Pixels Git submodule and canonical C++ Core
- `protocol-client/` — versioned, structured-clone-safe protocol contracts
- `worker/` — the only owner of WASM memory, C ABI handles, and parser sessions
- `extension/` — source adapters, snapshot policy, worker supervision, and host
  entry points
- `webview/` — the theme-aware five-view read-only inspector UI
- `resources/core/` — staged loader, WASM, and integrity manifest
- `scripts/` — deterministic Core build/stage and package verification
- `tests/` — protocol, source, supervisor, real worker, and browser validation

## Development

Node.js 24 or newer, CMake, Ninja, and the pinned Emscripten toolchain are
required when rebuilding Core. Normal TypeScript development uses:

```sh
npm ci
npm run check
npm run package:target -- linux-x64
```

The browser validation additionally needs a Chromium executable:

```sh
PIXELS_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:browser
```

Initialize and rebuild the submodule-owned Core only through the root scripts:

```sh
./scripts/init-submodules.sh
PIXELS_EMCMAKE=/path/to/emsdk/upstream/emscripten/emcmake npm run build:core
npm run stage:core
npm run verify:core
```

Do not build or copy artifacts from a sibling Pixels checkout. See
`docs/core-bump.md` for the reviewed update process.

## Platform and source support

The same WASM is packaged for Linux, macOS, and Windows on x64 and arm64.
Desktop and Remote hosts use positional reads for `file:` URIs. Browser and
virtual-workspace providers use a stat-checked immutable in-memory snapshot
with a visible 64 MiB limit. Direct object-store protocols are intentionally
deferred.

The V1 conformance inventory covers all eight TPC-H tables and 61 columns, with
the 16-column `lineitem` shape as the representative integration schema.
Per-table preview fixtures beyond that representative path are post-V1.
