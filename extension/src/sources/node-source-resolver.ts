import type * as vscode from "vscode";

import type { RangeSource } from "./range-source.js";
import { NodeFileRangeSource } from "./node-file-range-source.js";
import { openWorkspaceRangeSource } from "./workspace-range-source.js";

export async function openNodeRangeSource(
  uri: vscode.Uri,
): Promise<RangeSource> {
  if (uri.scheme === "file") {
    return await NodeFileRangeSource.open(uri.fsPath);
  }
  return await openWorkspaceRangeSource(uri);
}
