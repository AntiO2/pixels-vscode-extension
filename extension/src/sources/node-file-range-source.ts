import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { toSafeLength } from "@pixels-inspector/protocol-client";

import type { RangeSource, SourceIdentity } from "./range-source.js";
import {
  sourceError,
  throwIfAborted,
  validateRange,
} from "./source-errors.js";

interface FileFingerprint {
  readonly size: bigint;
  readonly modifiedAt: bigint;
}

function fingerprint(stat: BigIntStats): FileFingerprint {
  return {
    size: stat.size,
    modifiedAt: stat.mtimeNs,
  };
}

export class NodeFileRangeSource implements RangeSource {
  public readonly identity: SourceIdentity;
  public readonly size: bigint;
  private closed = false;

  private constructor(
    private readonly handle: FileHandle,
    private readonly fingerprint: FileFingerprint,
    uri: string,
  ) {
    this.size = fingerprint.size;
    this.identity = Object.freeze({
      uri,
      size: fingerprint.size,
      modifiedAt: fingerprint.modifiedAt,
      revision: `${fingerprint.size.toString()}:${fingerprint.modifiedAt.toString()}`,
    });
  }

  public static async open(filePath: string): Promise<NodeFileRangeSource> {
    const absolute = path.resolve(filePath);
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(absolute, "r");
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile()) {
        throw sourceError("SOURCE_IO", "source is not a regular file");
      }
      return new NodeFileRangeSource(
        handle,
        fingerprint(stat),
        pathToFileURL(absolute).href,
      );
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (error instanceof Error && error.name === "InspectorError") {
        throw error;
      }
      throw sourceError(
        "SOURCE_IO",
        `unable to open source file: ${absolute}`,
        error,
      );
    }
  }

  public async read(
    offset: bigint,
    length: bigint,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    this.requireOpen();
    throwIfAborted(signal);
    validateRange(this.size, offset, length);
    await this.assertUnchanged();

    const count = toSafeLength(length, "file range length");
    const position = toSafeLength(offset, "file range offset");
    const result = new Uint8Array(count);
    let consumed = 0;
    try {
      while (consumed < count) {
        throwIfAborted(signal);
        const read = await this.handle.read(
          result,
          consumed,
          count - consumed,
          position + consumed,
        );
        if (read.bytesRead === 0) {
          throw sourceError(
            "SHORT_READ",
            `source ended after ${String(consumed)} of ${String(count)} bytes`,
          );
        }
        consumed += read.bytesRead;
      }
      await this.assertUnchanged();
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "InspectorError") {
        throw error;
      }
      throw sourceError("SOURCE_IO", "unable to read source range", error);
    }
  }

  public async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      await this.handle.close();
    }
  }

  private async assertUnchanged(): Promise<void> {
    const current = fingerprint(await this.handle.stat({ bigint: true }));
    if (
      current.size !== this.fingerprint.size ||
      current.modifiedAt !== this.fingerprint.modifiedAt
    ) {
      throw sourceError(
        "SOURCE_CHANGED",
        "source changed after the inspection handle was opened",
      );
    }
  }

  private requireOpen(): void {
    if (this.closed) {
      throw sourceError("SOURCE_IO", "file source is closed");
    }
  }
}
