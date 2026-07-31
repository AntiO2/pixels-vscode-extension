# Architecture

## Runtime boundary

The product runtime is TypeScript plus one WebAssembly artifact. It does not
start Java, native helpers, databases, coordinators, object stores, or other
services. C++ in `third_party/pixels/cpp/pixels-inspector` is the canonical
portable reader slice; TypeScript orchestrates it but does not duplicate Pixels
format semantics.

```text
VS Code host
  source adapter -> worker supervisor -> structured-clone protocol
                                      -> Node or browser Worker
                                         -> WASM C ABI
                                            -> portable Pixels Core
```

## Ownership

The source adapter owns resource identity and byte acquisition. Local and
Remote-style files use positional reads through an open handle. Provider-backed
and virtual resources use a bounded buffer or a verified immutable snapshot;
non-file URIs are never converted into operating-system paths.

The supervisor owns worker generation, request timeout, cancellation,
replacement, and stale-message suppression. A hard failure always discards the
worker so no heap or parser session can leak into its replacement.

The worker owns the Emscripten module, WASM allocations, fixed-width C ABI
calls, parser handles, and result copies. It verifies the staged WASM size and
SHA-256 before instantiation. Unsigned 64-bit values remain `bigint` internally
and cross the protocol as canonical decimal strings.

The Core owns range planning, file-format validation, footer/schema parsing,
row-group layout, and decoding. Its C ABI is a narrow state machine: begin
metadata, row-group, or page inspection; request a bounded range; accept the
exact range; and return copied JSON or a typed error. The protocol client
validates those JSON results once before the extension or webview can consume
them. Core has no filesystem, network, Java, Asyncify, or JSPI dependency.

## Host variants

The Node entry uses `worker_threads` and file-backed sources. The browser entry
uses a Web Worker and provider-backed sources. Both load the same staged WASM
bytes and speak protocol version 1. A 64 MiB whole-file preflight limit is the
current explicit fallback policy for virtual providers; snapshot-capable hosts
can preserve range behavior.

Desktop, Remote, and virtual workspace support are architectural requirements.
Direct S3, HDFS, HTTP, and object-store providers are intentionally deferred.

## Custom editor

The extension host owns the read-only custom document, source lifetime, parser worker, cancellation, and refresh. The webview receives only validated, structured-clone-safe models and renders Analyze, Data, and Query workspaces. File content never becomes HTML, a command, a script URL, or a WASM URL; all content is inserted through DOM text nodes under a restrictive content-security policy.

## Failure model

Protocol, ABI, and digest mismatch fail before parsing. Invalid ranges, source
mutation, short reads, timeouts, cancellation, corruption, crashes, and memory
failure are surfaced as typed errors. Cancellation is cooperative first and
then enforced by worker termination/recreation. Responses from an older worker
generation are ignored.
