import {
  DEFAULT_BUFFER_SOURCE_LIMIT,
} from "@pixels-inspector/protocol-client";

import { BufferRangeSource } from "./buffer-range-source.js";
import type { RangeSource } from "./range-source.js";
import { sourceError } from "./source-errors.js";

export interface ProviderResourceStat {
  readonly size: number;
  readonly mtime: number;
}

export interface ProviderResourceApi<Resource, Stat extends ProviderResourceStat> {
  stat(resource: Resource): Promise<Stat>;
  readFile(resource: Resource): Promise<Uint8Array>;
  isFile(stat: Stat): boolean;
}

function safeBigInt(value: number, field: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw sourceError(
      "SOURCE_IO",
      `${field} is not a non-negative safe integer`,
    );
  }
  return BigInt(value);
}

export async function openProviderRangeSource<
  Resource,
  Stat extends ProviderResourceStat,
>(
  resource: Resource,
  uri: string,
  provider: ProviderResourceApi<Resource, Stat>,
  limit = DEFAULT_BUFFER_SOURCE_LIMIT,
): Promise<RangeSource> {
  try {
    const before = await provider.stat(resource);
    if (!provider.isFile(before)) {
      throw sourceError("SOURCE_IO", "source is not a file");
    }
    const size = safeBigInt(before.size, "provider source size");
    if (size > limit) {
      throw sourceError(
        "SOURCE_TOO_LARGE",
        `provider resource is ${size.toString()} bytes; in-memory limit is ${limit.toString()} bytes`,
      );
    }
    const bytes = await provider.readFile(resource);
    const after = await provider.stat(resource);
    if (
      before.size !== after.size ||
      before.mtime !== after.mtime ||
      bytes.byteLength !== before.size
    ) {
      throw sourceError(
        "SOURCE_CHANGED",
        "provider resource changed while creating its inspection snapshot",
      );
    }
    return new BufferRangeSource(uri, bytes, {
      limit,
      modifiedAt: safeBigInt(before.mtime, "provider modification time"),
      revision: `${String(before.size)}:${String(before.mtime)}`,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "InspectorError") {
      throw error;
    }
    throw sourceError(
      "SOURCE_IO",
      `unable to read provider source: ${uri}`,
      error,
    );
  }
}
