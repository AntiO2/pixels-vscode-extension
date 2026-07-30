import { describe, expect, it } from "vitest";

import {
  openProviderRangeSource,
} from "../../extension/src/sources/provider-range-source.js";

interface Stat {
  readonly size: number;
  readonly mtime: number;
  readonly file: boolean;
}

function provider(
  stats: readonly Stat[],
  bytes: Uint8Array,
): {
  stat(resource: string): Promise<Stat>;
  readFile(resource: string): Promise<Uint8Array>;
  isFile(stat: Stat): boolean;
} {
  let index = 0;
  return {
    stat(): Promise<Stat> {
      const value = stats[Math.min(index, stats.length - 1)];
      index += 1;
      if (value === undefined) {
        throw new Error("missing synthetic stat");
      }
      return Promise.resolve(value);
    },
    readFile(): Promise<Uint8Array> {
      return Promise.resolve(bytes);
    },
    isFile(stat): boolean {
      return stat.file;
    },
  };
}

describe("provider-backed source resolution", () => {
  it("creates an immutable bounded snapshot with stable identity", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const source = await openProviderRangeSource(
      "fixture",
      "vscode-vfs://fixture/data.pxl",
      provider(
        [
          { size: 4, mtime: 7, file: true },
          { size: 4, mtime: 7, file: true },
        ],
        bytes,
      ),
      8n,
    );
    try {
      expect(source.identity).toMatchObject({
        uri: "vscode-vfs://fixture/data.pxl",
        revision: "4:7",
        size: 4n,
      });
      await expect(
        source.read(1n, 2n, new AbortController().signal),
      ).resolves.toEqual(new Uint8Array([2, 3]));
    } finally {
      await source.close();
    }
  });

  it("rejects oversized and mutating provider resources", async () => {
    await expect(
      openProviderRangeSource(
        "large",
        "vscode-vfs://fixture/large.pxl",
        provider(
          [{ size: 9, mtime: 1, file: true }],
          new Uint8Array(9),
        ),
        8n,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });

    await expect(
      openProviderRangeSource(
        "changing",
        "vscode-vfs://fixture/changing.pxl",
        provider(
          [
            { size: 4, mtime: 1, file: true },
            { size: 4, mtime: 2, file: true },
          ],
          new Uint8Array(4),
        ),
        8n,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
  });
});
