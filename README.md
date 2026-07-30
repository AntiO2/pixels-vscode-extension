# Pixels Inspector for VS Code

Pixels Inspector is a cross-platform VS Code extension for inspecting Pixels
files without adding a JVM or service runtime to the product. Parsing semantics
live in the portable C++ Pixels Core and are delivered to desktop, Remote, and
web extension hosts as WebAssembly.

This repository is under active development. The current production-shaped
slice validates the pinned Core artifact, strict worker protocol, exact range
I/O, cancellation/recovery, and identical Node/browser execution. The custom
editor and its five production views are downstream work and are not advertised
as complete.

## Repository layout

- `third_party/pixels/` — the exact Pixels Git submodule and canonical C++ Core
- `protocol-client/` — versioned, structured-clone-safe protocol contracts
- `worker/` — the only owner of WASM memory, C ABI handles, and parser sessions
- `extension/` — source adapters, snapshot policy, worker supervision, and host
  entry points
- `resources/core/` — staged loader, WASM, and integrity manifest
- `scripts/` — deterministic Core build/stage and package verification
- `tests/` — protocol, source, supervisor, real worker, and browser validation

## Development

Node.js 24 or newer, CMake, Ninja, and the pinned Emscripten toolchain are
required when rebuilding Core. Normal TypeScript development uses:

```sh
npm ci
npm run check
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
