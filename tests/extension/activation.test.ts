import path from "node:path";

import type * as vscode from "vscode";
import { describe, expect, it, vi } from "vitest";

const vscodeMock = vi.hoisted(() => ({
  register: vi.fn(
    (
      viewType: string,
      provider: unknown,
      options: unknown,
    ) => {
      void viewType;
      void provider;
      void options;
      return { dispose: vi.fn() };
    },
  ),
}));

vi.mock("vscode", () => ({
  window: {
    registerCustomEditorProvider: vscodeMock.register,
  },
}));

import { activate } from "../../extension/src/node.js";

describe("desktop extension activation", () => {
  it("registers the read-only PXL custom editor from the root package", async () => {
    const root = path.resolve(".");
    const subscriptions: { dispose(): unknown }[] = [];
    const context = Object.create(null) as vscode.ExtensionContext;
    Object.assign(context, {
      asAbsolutePath(relativePath: string): string {
        return path.join(root, relativePath);
      },
      extensionUri: {
        scheme: "file",
        authority: "",
        path: root,
        query: "",
        fragment: "",
        fsPath: root,
        with: vi.fn(),
        toJSON: vi.fn(),
        toString: vi.fn(() => `file://${root}`),
      },
      subscriptions,
    });
    await activate(context);

    expect(vscodeMock.register).toHaveBeenCalledOnce();
    expect(vscodeMock.register.mock.calls[0]?.[0]).toBe(
      "pixels.pxlInspector",
    );
    expect(vscodeMock.register.mock.calls[0]?.[2]).toMatchObject({
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: true },
    });
    expect(subscriptions).toHaveLength(1);
  });
});
