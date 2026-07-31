# Source and workspace policy

Every inspected resource is represented by a stable identity, immutable size,
and exact `read(offset, length)` operation. The adapter must either return the
complete requested range or fail; silent short reads are invalid.

Local and Remote-style file adapters keep a file handle open, use positional
reads, and compare identity metadata to detect replacement or mutation. Paths
with spaces and non-ASCII characters are supported. URI text is not treated as
a path unless its scheme is `file`.

Virtual/provider resources have two explicit strategies:

- A bounded in-memory source after checking the declared size. The current
  whole-file ceiling is 64 MiB.
- Materialization through provider and storage interfaces, with stat-before,
  copy, stat-after, mutation rejection, atomic publication of immutable
  identity, cache invalidation, and cleanup on error or cancellation.

The browser/virtual policy must never allocate an unbounded provider response. Oversized resources receive a visible typed error until a host-specific snapshot strategy is available. Direct object-storage protocols are not part of this policy yet.
