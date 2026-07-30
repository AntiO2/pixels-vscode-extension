import type { RangeSource, SourceIdentity } from "./range-source.js";
import { sourceError, throwIfAborted } from "./source-errors.js";

export interface ProviderStat {
  readonly size: bigint;
  readonly modifiedAt: bigint | undefined;
}

export interface ProviderFileSystem {
  stat(uri: string): Promise<ProviderStat>;
  copy(sourceUri: string, destinationUri: string): Promise<void>;
}

export interface SnapshotStorage {
  createTemporaryUri(sourceUri: string): Promise<string>;
  publish(
    temporaryUri: string,
    identity: SourceIdentity,
  ): Promise<string>;
  open(snapshotUri: string, identity: SourceIdentity): Promise<RangeSource>;
  remove(uri: string): Promise<void>;
}

interface CachedSnapshot {
  readonly sourceIdentity: SourceIdentity;
  readonly snapshotUri: string;
}

function identityFor(uri: string, stat: ProviderStat): SourceIdentity {
  return Object.freeze({
    uri,
    size: stat.size,
    modifiedAt: stat.modifiedAt,
    revision: `${stat.size.toString()}:${stat.modifiedAt?.toString() ?? "unknown"}`,
  });
}

function sameStat(left: ProviderStat, right: ProviderStat): boolean {
  return left.size === right.size && left.modifiedAt === right.modifiedAt;
}

export class SnapshotMaterializer {
  private readonly cache = new Map<string, CachedSnapshot>();

  public constructor(
    private readonly provider: ProviderFileSystem,
    private readonly storage: SnapshotStorage,
    private readonly maximumSnapshotBytes: bigint,
  ) {}

  public async materialize(
    sourceUri: string,
    signal: AbortSignal,
  ): Promise<RangeSource> {
    throwIfAborted(signal);
    const before = await this.provider.stat(sourceUri);
    if (before.size > this.maximumSnapshotBytes) {
      throw sourceError(
        "SOURCE_TOO_LARGE",
        `provider resource is ${before.size.toString()} bytes; snapshot limit is ${this.maximumSnapshotBytes.toString()} bytes`,
      );
    }
    const identity = identityFor(sourceUri, before);
    const cached = this.cache.get(sourceUri);
    if (cached?.sourceIdentity.revision === identity.revision) {
      return await this.storage.open(cached.snapshotUri, identity);
    }
    if (cached !== undefined) {
      await this.storage.remove(cached.snapshotUri);
      this.cache.delete(sourceUri);
    }

    const temporaryUri = await this.storage.createTemporaryUri(sourceUri);
    let publishedUri: string | undefined;
    try {
      throwIfAborted(signal);
      await this.provider.copy(sourceUri, temporaryUri);
      throwIfAborted(signal);
      const after = await this.provider.stat(sourceUri);
      if (!sameStat(before, after)) {
        throw sourceError(
          "SOURCE_CHANGED",
          "provider resource changed while creating an inspection snapshot",
        );
      }
      publishedUri = await this.storage.publish(temporaryUri, identity);
      this.cache.set(sourceUri, {
        sourceIdentity: identity,
        snapshotUri: publishedUri,
      });
      return await this.storage.open(publishedUri, identity);
    } catch (error) {
      await this.storage
        .remove(publishedUri ?? temporaryUri)
        .catch(() => undefined);
      if (error instanceof Error && error.name === "InspectorError") {
        throw error;
      }
      throw sourceError(
        "SOURCE_IO",
        "unable to materialize provider resource",
        error,
      );
    }
  }

  public async invalidate(sourceUri: string): Promise<void> {
    const cached = this.cache.get(sourceUri);
    if (cached !== undefined) {
      this.cache.delete(sourceUri);
      await this.storage.remove(cached.snapshotUri);
    }
  }

  public async dispose(): Promise<void> {
    const snapshots = [...this.cache.values()];
    this.cache.clear();
    await Promise.all(
      snapshots.map(async ({ snapshotUri }) => {
        await this.storage.remove(snapshotUri).catch(() => undefined);
      }),
    );
  }
}
