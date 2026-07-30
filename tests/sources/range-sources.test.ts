import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BufferRangeSource } from "../../extension/src/sources/buffer-range-source.js";
import { NodeFileRangeSource } from "../../extension/src/sources/node-file-range-source.js";
import type { InspectorError } from "@pixels-inspector/protocol-client";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await fs.rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("bounded range sources", () => {
  it("copies only the requested provider buffer range", async () => {
    const source = new BufferRangeSource(
      "test-provider://authority/no/path",
      Uint8Array.from([0, 1, 2, 3, 4]),
      { limit: 5n },
    );
    await expect(
      source.read(1n, 3n, new AbortController().signal),
    ).resolves.toEqual(Uint8Array.from([1, 2, 3]));
    await expect(
      source.read(4n, 2n, new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RANGE" });
  });

  it("rejects provider bytes before accepting an over-limit buffer", () => {
    expect(
      () =>
        new BufferRangeSource(
          "test-provider://large",
          new Uint8Array(9),
          { limit: 8n },
        ),
    ).toThrow(
      expect.objectContaining<Partial<InspectorError>>({
        code: "SOURCE_TOO_LARGE",
      }),
    );
  });

  it("uses positional reads for a path with spaces and Unicode", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "pixels-range-source-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "数据 fixture with spaces.pxl");
    await fs.writeFile(filePath, Uint8Array.from([10, 11, 12, 13, 14]));
    const source = await NodeFileRangeSource.open(filePath);
    try {
      await expect(
        source.read(2n, 2n, new AbortController().signal),
      ).resolves.toEqual(Uint8Array.from([12, 13]));
      expect(source.identity.uri).toContain("%E6%95%B0%E6%8D%AE");
    } finally {
      await source.close();
    }
  });

  it("detects a source mutation after open", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "pixels-range-mutation-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "fixture.pxl");
    await fs.writeFile(filePath, Uint8Array.from([1, 2, 3]));
    const source = await NodeFileRangeSource.open(filePath);
    try {
      await fs.appendFile(filePath, Uint8Array.from([4]));
      await expect(
        source.read(0n, 1n, new AbortController().signal),
      ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    } finally {
      await source.close();
    }
  });

  it("honors cancellation before a read", async () => {
    const controller = new AbortController();
    controller.abort("test");
    const source = new BufferRangeSource(
      "test-provider://cancel",
      new Uint8Array(1),
    );
    await expect(source.read(0n, 1n, controller.signal)).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });
});
