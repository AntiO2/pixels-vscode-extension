import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type * as vscode from "vscode";

import {
  decodeCoreManifest,
} from "@pixels-inspector/protocol-client";

import { registerInspector } from "./custom-editor.js";
import { openNodeRangeSource } from "./sources/node-source-resolver.js";
import { NodeWorkerFactory } from "./worker/node-worker-transport.js";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const coreDirectory = context.asAbsolutePath("resources/core");
  const manifest = decodeCoreManifest(
    JSON.parse(
      await fs.readFile(
        path.join(coreDirectory, "core-manifest.json"),
        "utf8",
      ),
    ) as unknown,
  );
  registerInspector(context, {
    manifest,
    workerFactory: new NodeWorkerFactory(
      pathToFileURL(
        context.asAbsolutePath("dist/worker/node.mjs"),
      ),
    ),
    locations: {
      loaderUrl: path.join(
        coreDirectory,
        "pixels-inspector-wasm.cjs",
      ),
      wasmUrl: path.join(coreDirectory, "pixels-inspector-wasm.wasm"),
    },
    openSource: openNodeRangeSource,
  });
}

export function deactivate(): void {
  // VS Code disposes registered providers and their editor sessions.
}
