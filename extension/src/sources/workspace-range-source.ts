import * as vscode from "vscode";

import type { RangeSource } from "./range-source.js";
import { openProviderRangeSource } from "./provider-range-source.js";

export async function openWorkspaceRangeSource(
  uri: vscode.Uri,
  limit?: bigint,
): Promise<RangeSource> {
  return await openProviderRangeSource(
    uri,
    uri.toString(true),
    {
      stat: async (resource) => await vscode.workspace.fs.stat(resource),
      readFile: async (resource) =>
        await vscode.workspace.fs.readFile(resource),
      isFile: (stat) => (stat.type & vscode.FileType.File) !== 0,
    },
    limit,
  );
}
