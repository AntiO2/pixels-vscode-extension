import * as vscode from "vscode";

import {
  decodeCoreManifest,
} from "@pixels-inspector/protocol-client";

import { registerInspector } from "./custom-editor.js";
import { openWorkspaceRangeSource } from "./sources/workspace-range-source.js";
import { BrowserWorkerFactory } from "./worker/browser-worker-transport.js";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const coreDirectory = vscode.Uri.joinPath(
    context.extensionUri,
    "resources",
    "core",
  );
  const manifestBytes = await vscode.workspace.fs.readFile(
    vscode.Uri.joinPath(coreDirectory, "core-manifest.json"),
  );
  const manifest = decodeCoreManifest(
    JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown,
  );
  registerInspector(context, {
    manifest,
    workerFactory: new BrowserWorkerFactory(
      vscode.Uri.joinPath(
        context.extensionUri,
        "dist",
        "worker",
        "browser.js",
      ).toString(true),
    ),
    locations: {
      loaderUrl: vscode.Uri.joinPath(
        coreDirectory,
        "pixels-inspector-wasm.cjs",
      ).toString(true),
      wasmUrl: vscode.Uri.joinPath(
        coreDirectory,
        "pixels-inspector-wasm.wasm",
      ).toString(true),
    },
    openSource: openWorkspaceRangeSource,
  });
}

export function deactivate(): void {
  // VS Code disposes registered providers and their editor sessions.
}
