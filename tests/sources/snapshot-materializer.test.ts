import { BufferRangeSource } from "../../extension/src/sources/buffer-range-source.js";
import type {
  ProviderFileSystem,
  ProviderStat,
  SnapshotStorage,
} from "../../extension/src/sources/snapshot-materializer.js";
import { SnapshotMaterializer } from "../../extension/src/sources/snapshot-materializer.js";
import type {
  RangeSource,
  SourceIdentity,
} from "../../extension/src/sources/range-source.js";
import { describe, expect, it } from "vitest";

class TestProvider implements ProviderFileSystem {
  public statValue: ProviderStat = {
    size: 3n,
    modifiedAt: 7n,
  };
  public copyCount = 0;
  public mutateAfterCopy = false;
  public copyError: Error | undefined;

  public stat(): Promise<ProviderStat> {
    return Promise.resolve(this.statValue);
  }

  public copy(): Promise<void> {
    this.copyCount += 1;
    if (this.copyError !== undefined) {
      throw this.copyError;
    }
    if (this.mutateAfterCopy) {
      this.statValue = {
        size: 4n,
        modifiedAt: 8n,
      };
    }
    return Promise.resolve();
  }
}

class TestStorage implements SnapshotStorage {
  public readonly removed: string[] = [];
  public publishCount = 0;

  public createTemporaryUri(): Promise<string> {
    return Promise.resolve("storage://temporary");
  }

  public publish(): Promise<string> {
    this.publishCount += 1;
    return Promise.resolve(
      `storage://published-${String(this.publishCount)}`,
    );
  }

  public open(
    snapshotUri: string,
    identity: SourceIdentity,
  ): Promise<RangeSource> {
    return Promise.resolve(
      new BufferRangeSource(
        snapshotUri,
        Uint8Array.from([1, 2, 3]),
        {
          ...(identity.modifiedAt === undefined
            ? {}
            : { modifiedAt: identity.modifiedAt }),
          revision: identity.revision,
        },
      ),
    );
  }

  public remove(uri: string): Promise<void> {
    this.removed.push(uri);
    return Promise.resolve();
  }
}

describe("provider snapshot materialization", () => {
  it("reuses stable identity and invalidates a changed snapshot", async () => {
    const provider = new TestProvider();
    const storage = new TestStorage();
    const materializer = new SnapshotMaterializer(
      provider,
      storage,
      10n,
    );
    const signal = new AbortController().signal;

    const first = await materializer.materialize(
      "test-vfs://authority/no/path",
      signal,
    );
    await first.close();
    const second = await materializer.materialize(
      "test-vfs://authority/no/path",
      signal,
    );
    await second.close();
    expect(provider.copyCount).toBe(1);

    provider.statValue = { size: 3n, modifiedAt: 9n };
    const third = await materializer.materialize(
      "test-vfs://authority/no/path",
      signal,
    );
    await third.close();
    expect(provider.copyCount).toBe(2);
    expect(storage.removed).toContain("storage://published-1");
    await materializer.dispose();
  });

  it("removes temporary data when the source mutates", async () => {
    const provider = new TestProvider();
    provider.mutateAfterCopy = true;
    const storage = new TestStorage();
    const materializer = new SnapshotMaterializer(
      provider,
      storage,
      10n,
    );
    await expect(
      materializer.materialize(
        "test-vfs://mutation",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(storage.removed).toContain("storage://temporary");
  });

  it("rejects size before provider copy and cleans copy failures", async () => {
    const provider = new TestProvider();
    const storage = new TestStorage();
    provider.statValue = { size: 11n, modifiedAt: 1n };
    const materializer = new SnapshotMaterializer(
      provider,
      storage,
      10n,
    );
    await expect(
      materializer.materialize(
        "test-vfs://large",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    expect(provider.copyCount).toBe(0);

    provider.statValue = { size: 3n, modifiedAt: 1n };
    provider.copyError = new Error("provider unavailable");
    await expect(
      materializer.materialize(
        "test-vfs://error",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_IO" });
    expect(storage.removed).toContain("storage://temporary");
  });

  it("cleans an aborted materialization", async () => {
    const provider = new TestProvider();
    const storage = new TestStorage();
    const materializer = new SnapshotMaterializer(
      provider,
      storage,
      10n,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      materializer.materialize("test-vfs://cancel", controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
