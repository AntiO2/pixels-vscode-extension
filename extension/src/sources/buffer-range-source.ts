import {
  DEFAULT_BUFFER_SOURCE_LIMIT,
  toSafeLength,
} from "@pixels-inspector/protocol-client";

import type { RangeSource, SourceIdentity } from "./range-source.js";
import {
  sourceError,
  throwIfAborted,
  validateRange,
} from "./source-errors.js";

export class BufferRangeSource implements RangeSource {
  public readonly size: bigint;
  public readonly identity: SourceIdentity;
  private closed = false;

  public constructor(
    uri: string,
    private readonly bytes: Uint8Array,
    options: {
      readonly modifiedAt?: bigint;
      readonly revision?: string;
      readonly limit?: bigint;
    } = {},
  ) {
    this.size = BigInt(bytes.byteLength);
    const limit = options.limit ?? DEFAULT_BUFFER_SOURCE_LIMIT;
    if (this.size > limit) {
      throw sourceError(
        "SOURCE_TOO_LARGE",
        `provider resource is ${this.size.toString()} bytes; in-memory limit is ${limit.toString()} bytes`,
      );
    }
    this.identity = Object.freeze({
      uri,
      size: this.size,
      modifiedAt: options.modifiedAt,
      revision:
        options.revision ??
        `${this.size.toString()}:${options.modifiedAt?.toString() ?? "unknown"}`,
    });
  }

  public read(
    offset: bigint,
    length: bigint,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      throwIfAborted(signal);
      validateRange(this.size, offset, length);
      const start = toSafeLength(offset, "buffer offset");
      const count = toSafeLength(length, "buffer length");
      const result = this.bytes.slice(start, start + count);
      throwIfAborted(signal);
      return result;
    });
  }

  public close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  private requireOpen(): void {
    if (this.closed) {
      throw sourceError("SOURCE_IO", "buffer source is closed");
    }
  }
}
