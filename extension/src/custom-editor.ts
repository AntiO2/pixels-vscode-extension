import * as vscode from "vscode";

import {
  InspectorError,
  parseUnsignedDecimal,
  toInspectorError,
} from "@pixels-inspector/protocol-client";
import type {
  CoreManifest,
  MetadataResult,
} from "@pixels-inspector/protocol-client";

import type { RangeSource } from "./sources/range-source.js";
import type { WorkerFactory } from "./worker/transport.js";
import { WorkerSupervisor } from "./worker/worker-supervisor.js";

export const INSPECTOR_VIEW_TYPE = "pixels.pxlInspector";
const MAX_PREVIEW_ROWS = 500;
const DEFAULT_PREVIEW_ROWS = 100;

export interface InspectorRuntime {
  readonly manifest: CoreManifest;
  readonly workerFactory: WorkerFactory;
  readonly locations: {
    readonly loaderUrl: string;
    readonly wasmUrl: string;
  };
  openSource(uri: vscode.Uri): Promise<RangeSource>;
}

class PixelsDocument implements vscode.CustomDocument {
  public constructor(public readonly uri: vscode.Uri) {}

  public dispose(): void {
    // Each editor panel owns its own immutable source snapshot and worker.
  }
}

interface Selection {
  readonly rowGroup: number;
  readonly column: number;
  readonly rowOffset: bigint;
  readonly rowCount: number;
}

function nonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function decodeSelection(
  value: unknown,
  metadata: MetadataResult,
): Selection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InspectorError("INVALID_MESSAGE", "selection must be an object");
  }
  const source = value as Record<string, unknown>;
  const rowGroup = source["rowGroup"];
  const column = source["column"];
  const rowCount = source["rowCount"];
  const rowOffset = source["rowOffset"];
  if (
    typeof rowGroup !== "number" ||
    !Number.isSafeInteger(rowGroup) ||
    rowGroup < 0 ||
    rowGroup >= metadata.rowGroups.length ||
    typeof column !== "number" ||
    !Number.isSafeInteger(column) ||
    column < 0 ||
    column >= metadata.schema.length ||
    typeof rowCount !== "number" ||
    !Number.isSafeInteger(rowCount) ||
    rowCount <= 0 ||
    rowCount > MAX_PREVIEW_ROWS ||
    typeof rowOffset !== "string"
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "preview selection is outside the inspected schema",
    );
  }
  const decodedOffset = parseUnsignedDecimal(rowOffset, "rowOffset");
  const groupRows = BigInt(metadata.rowGroups[rowGroup]?.rows ?? 0);
  if (
    decodedOffset >= groupRows ||
    decodedOffset + BigInt(rowCount) > groupRows
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "preview selection is outside the selected row group",
    );
  }
  return {
    rowGroup,
    column,
    rowOffset: decodedOffset,
    rowCount,
  };
}

class EditorSession {
  private readonly supervisor: WorkerSupervisor;
  private source: RangeSource | undefined;
  private metadata: MetadataResult | undefined;
  private revision = 0;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  public constructor(
    private readonly document: PixelsDocument,
    private readonly panel: vscode.WebviewPanel,
    private readonly runtime: InspectorRuntime,
  ) {
    this.supervisor = new WorkerSupervisor(
      runtime.workerFactory,
      runtime.manifest,
      runtime.locations,
    );
  }

  public start(): void {
    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      this.receive(message);
    });
    this.panel.onDidDispose(() => {
      void this.dispose();
    });
  }

  private receive(value: unknown): void {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      this.postError(
        new InspectorError("INVALID_MESSAGE", "webview message is invalid"),
      );
      return;
    }
    const message = value as Record<string, unknown>;
    if (message["kind"] === "ready") {
      this.enqueue(async (revision) => {
        await this.reload(revision);
      });
      return;
    }
    if (message["kind"] === "refresh") {
      this.enqueue(async (revision) => {
        await this.reload(revision);
      });
      return;
    }
    if (message["kind"] === "select") {
      const metadata = this.metadata;
      if (metadata === undefined) {
        this.postError(
          new InspectorError(
            "INVALID_MESSAGE",
            "metadata is not ready for selection",
            true,
          ),
        );
        return;
      }
      try {
        const selection = decodeSelection(message, metadata);
        this.enqueue(async (revision) => {
          await this.loadSelection(revision, selection, true);
        });
      } catch (error) {
        this.postError(toInspectorError(error));
      }
      return;
    }
    this.postError(
      new InspectorError("INVALID_MESSAGE", "unknown webview message"),
    );
  }

  private enqueue(action: (revision: number) => Promise<void>): void {
    const revision = ++this.revision;
    const cancellation = this.supervisor.cancelActive();
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        await cancellation;
        if (!this.disposed && revision === this.revision) {
          await action(revision);
        }
      })
      .catch((error: unknown) => {
        if (revision === this.revision && !this.disposed) {
          this.postError(toInspectorError(error));
        }
      });
  }

  private async reload(revision: number): Promise<void> {
    this.post({ kind: "loading", stage: "source", revision });
    await this.source?.close();
    this.source = undefined;
    const nextSource = await this.runtime.openSource(this.document.uri);
    try {
      this.requireCurrent(revision);
    } catch (error) {
      await nextSource.close();
      throw error;
    }
    this.source = nextSource;
    await this.supervisor.restart();
    this.post({ kind: "loading", stage: "metadata", revision });
    const metadata = await this.supervisor.inspectMetadata(this.source);
    this.requireCurrent(revision);
    this.metadata = metadata;
    this.post({
      kind: "metadata",
      revision,
      source: {
        uri: this.source.identity.uri,
        size: this.source.size.toString(),
        revision: this.source.identity.revision,
      },
      capabilities: this.supervisor.capabilities,
      metadata,
    });
    const firstGroup = metadata.rowGroups[0];
    if (
      firstGroup !== undefined &&
      firstGroup.rows > 0 &&
      metadata.schema.length > 0
    ) {
      await this.loadSelection(revision, {
        rowGroup: 0,
        column: 0,
        rowOffset: 0n,
        rowCount: Math.min(firstGroup.rows, DEFAULT_PREVIEW_ROWS),
      });
    } else {
      this.post({ kind: "empty", revision });
    }
  }

  private async loadSelection(
    revision: number,
    selection: Selection,
    resetSession = false,
  ): Promise<void> {
    const source = this.source;
    if (source === undefined) {
      throw new InspectorError("INTERNAL", "inspection source is unavailable");
    }
    if (resetSession) {
      await this.supervisor.restart();
      this.post({ kind: "loading", stage: "metadata", revision });
      const metadata = await this.supervisor.inspectMetadata(source);
      this.requireCurrent(revision);
      this.metadata = metadata;
      this.post({
        kind: "metadata",
        revision,
        source: {
          uri: source.identity.uri,
          size: source.size.toString(),
          revision: source.identity.revision,
        },
        capabilities: this.supervisor.capabilities,
        metadata,
      });
    }
    this.post({ kind: "loading", stage: "rowGroup", revision });
    const rowGroup = await this.supervisor.inspectRowGroup(
      source,
      selection.rowGroup,
    );
    this.requireCurrent(revision);
    this.post({ kind: "rowGroup", revision, rowGroup });
    this.post({ kind: "loading", stage: "page", revision });
    const page = await this.supervisor.inspectPage(source, selection);
    this.requireCurrent(revision);
    this.post({ kind: "page", revision, page });
  }

  private requireCurrent(revision: number): void {
    if (this.disposed || revision !== this.revision) {
      throw new InspectorError(
        "CANCELLED",
        "inspection result was superseded",
        true,
      );
    }
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private postError(error: InspectorError): void {
    if (error.code !== "CANCELLED") {
      this.post({
        kind: "error",
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
        revision: this.revision,
      });
    }
  }

  private async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.revision += 1;
    await this.supervisor.dispose();
    await this.source?.close();
    this.source = undefined;
  }
}

class PixelsEditorProvider
implements vscode.CustomReadonlyEditorProvider<PixelsDocument> {
  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly runtime: InspectorRuntime,
  ) {}

  public openCustomDocument(
    uri: vscode.Uri,
  ): PixelsDocument {
    return new PixelsDocument(uri);
  }

  public resolveCustomEditor(
    document: PixelsDocument,
    panel: vscode.WebviewPanel,
  ): void {
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "dist",
        "webview",
        "main.js",
      ),
    );
    const styleUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "dist",
        "webview",
        "styles.css",
      ),
    );
    const token = nonce();
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(
          this.context.extensionUri,
          "dist",
          "webview",
        ),
      ],
    };
    panel.webview.html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource}; script-src 'nonce-${token}';">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Pixels Inspector</title>
</head>
<body>
  <div id="app" role="application" aria-label="Pixels PXL Inspector"></div>
  <script nonce="${token}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
    new EditorSession(document, panel, this.runtime).start();
  }
}

export function registerInspector(
  context: vscode.ExtensionContext,
  runtime: InspectorRuntime,
): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      INSPECTOR_VIEW_TYPE,
      new PixelsEditorProvider(context, runtime),
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  );
}
