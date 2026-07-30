import fs from "node:fs/promises";
import {
  describe,
  expect,
  it,
} from "vitest";

describe("Pixels Inspector configuration manifest", () => {
  it("publishes bounded presentation and virtual snapshot defaults", async () => {
    const manifest: unknown = JSON.parse(
      await fs.readFile("package.json", "utf8"),
    );
    expect(manifest).toMatchObject({
      contributes: {
        configuration: {
          properties: {
            "pixels.inspector.defaultPageSize": {
              enum: [25, 50, 100, 200, 500],
              default: 100,
              scope: "resource",
            },
            "pixels.inspector.defaultDataOrientation": {
              enum: ["rows", "column"],
              default: "rows",
              scope: "resource",
            },
            "pixels.inspector.timestampDisplay": {
              enum: ["utc", "raw", "local"],
              default: "utc",
              scope: "resource",
            },
            "pixels.inspector.maxVirtualFileSizeMiB": {
              minimum: 1,
              maximum: 256,
              default: 64,
              scope: "resource",
            },
          },
        },
      },
    });
  });
});
