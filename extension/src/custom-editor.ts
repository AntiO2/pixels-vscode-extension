import * as vscode from "vscode";

import {
  InspectorError,
  parseUnsignedDecimal,
  toInspectorError,
} from "@pixels-inspector/protocol-client";
import type {
  CoreManifest,
  FilterOperator,
  MetadataResult,
} from "@pixels-inspector/protocol-client";

import type { RangeSource } from "./sources/range-source.js";
import type { WorkerFactory } from "./worker/transport.js";
import { WorkerSupervisor } from "./worker/worker-supervisor.js";

export const INSPECTOR_VIEW_TYPE = "pixels.pxlInspector";
const MAX_PREVIEW_ROWS = 500;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_DATA_ORIENTATION = "rows";
const DEFAULT_TIMESTAMP_DISPLAY = "utc";
const DEFAULT_MAX_VIRTUAL_FILE_SIZE_MIB = 64;
const MAX_VIRTUAL_FILE_SIZE_MIB = 256;
const MEBIBYTE = 1024n * 1024n;

type PageSize = 25 | 50 | 100 | 200 | 500;
type DataOrientation = "rows" | "column";
type TimestampDisplay = "utc" | "raw" | "local";

interface InspectorPreferences {
  readonly pageSize: PageSize;
  readonly orientation: DataOrientation;
  readonly timestampDisplay: TimestampDisplay;
  readonly maximumVirtualFileBytes: bigint;
}

export interface InspectorRuntime {
  readonly manifest: CoreManifest;
  readonly workerFactory: WorkerFactory;
  readonly locations: {
    readonly loaderUrl: string;
    readonly wasmUrl: string;
  };
  openSource(uri: vscode.Uri, limit?: bigint): Promise<RangeSource>;
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

interface RowsSelection {
  readonly rowGroup: number;
  readonly columns: readonly number[];
  readonly rowOffset: bigint;
  readonly rowCount: number;
}

interface FilterSelection {
  readonly predicate: {
    readonly column: number;
    readonly operator: FilterOperator;
    readonly literal: string;
  };
  readonly columns: readonly number[];
  readonly cursor?: string;
  readonly limit: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPreferences(uri: vscode.Uri): InspectorPreferences {
  const configuration = vscode.workspace.getConfiguration(
    "pixels.inspector",
    uri,
  );
  const configuredPageSize = configuration.get<unknown>("defaultPageSize");
  const pageSize: PageSize =
    configuredPageSize === 25 ||
    configuredPageSize === 50 ||
    configuredPageSize === 100 ||
    configuredPageSize === 200 ||
    configuredPageSize === 500
      ? configuredPageSize
      : DEFAULT_PAGE_SIZE;
  const configuredOrientation = configuration.get<unknown>(
    "defaultDataOrientation",
  );
  const orientation: DataOrientation =
    configuredOrientation === "rows" ||
    configuredOrientation === "column"
      ? configuredOrientation
      : DEFAULT_DATA_ORIENTATION;
  const configuredTimestampDisplay =
    configuration.get<unknown>("timestampDisplay");
  const timestampDisplay: TimestampDisplay =
    configuredTimestampDisplay === "utc" ||
    configuredTimestampDisplay === "raw" ||
    configuredTimestampDisplay === "local"
      ? configuredTimestampDisplay
      : DEFAULT_TIMESTAMP_DISPLAY;
  const configuredMaximum = configuration.get<unknown>(
    "maxVirtualFileSizeMiB",
  );
  const maximumMiB =
    typeof configuredMaximum === "number" &&
    Number.isSafeInteger(configuredMaximum) &&
    configuredMaximum >= 1 &&
    configuredMaximum <= MAX_VIRTUAL_FILE_SIZE_MIB
      ? configuredMaximum
      : DEFAULT_MAX_VIRTUAL_FILE_SIZE_MIB;
  return {
    pageSize,
    orientation,
    timestampDisplay,
    maximumVirtualFileBytes: BigInt(maximumMiB) * MEBIBYTE,
  };
}

function decodeColumns(
  value: unknown,
  metadata: MetadataResult,
): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "projection must contain at least one root column",
    );
  }
  const nestedColumns = new Set(
    metadata.schema.flatMap((type) => [...type.subtypes]),
  );
  const columns = value.map((column, index) => {
    if (
      typeof column !== "number" ||
      !Number.isSafeInteger(column) ||
      column < 0 ||
      metadata.schema[column] === undefined ||
      nestedColumns.has(column)
    ) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        `projection column ${String(index)} is not a root schema column`,
      );
    }
    return column;
  });
  if (new Set(columns).size !== columns.length) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "projection columns must be unique",
    );
  }
  return columns;
}

function rootColumnIds(
  metadata: MetadataResult,
): readonly number[] {
  const nestedColumns = new Set(
    metadata.schema.flatMap((type) => [...type.subtypes]),
  );
  return metadata.schema
    .filter((type) => !nestedColumns.has(type.id))
    .map((type) => type.id);
}

function decodeBoundedRows(
  source: Record<string, unknown>,
  metadata: MetadataResult,
): {
  readonly rowGroup: number;
  readonly rowOffset: bigint;
  readonly rowCount: number;
} {
  const rowGroup = source["rowGroup"];
  const rowOffset = source["rowOffset"];
  const rowCount = source["rowCount"];
  if (
    typeof rowGroup !== "number" ||
    !Number.isSafeInteger(rowGroup) ||
    rowGroup < 0 ||
    rowGroup >= metadata.rowGroups.length ||
    typeof rowOffset !== "string" ||
    typeof rowCount !== "number" ||
    !Number.isSafeInteger(rowCount) ||
    rowCount <= 0 ||
    rowCount > MAX_PREVIEW_ROWS
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "row selection is outside host bounds",
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
      "row selection is outside the selected row group",
    );
  }
  return { rowGroup, rowOffset: decodedOffset, rowCount };
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
  if (!isRecord(value)) {
    throw new InspectorError("INVALID_MESSAGE", "selection must be an object");
  }
  const bounded = decodeBoundedRows(value, metadata);
  const column = value["column"];
  if (
    typeof column !== "number" ||
    !Number.isSafeInteger(column) ||
    column < 0 ||
    column >= metadata.schema.length
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "preview selection is outside the inspected schema",
    );
  }
  return {
    rowGroup: bounded.rowGroup,
    column,
    rowOffset: bounded.rowOffset,
    rowCount: bounded.rowCount,
  };
}

export function decodeRowsSelection(
  value: unknown,
  metadata: MetadataResult,
): RowsSelection {
  if (!isRecord(value)) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "row projection must be an object",
    );
  }
  return {
    ...decodeBoundedRows(value, metadata),
    columns: decodeColumns(value["columns"], metadata),
  };
}

function decodeFilterOperator(value: unknown): FilterOperator {
  switch (value) {
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
    case "isNull":
    case "isNotNull":
    case "contains":
      return value;
    default:
      throw new InspectorError(
        "INVALID_MESSAGE",
        "filter operator is unsupported",
      );
  }
}

export function decodeFilterSelection(
  value: unknown,
  metadata: MetadataResult,
): FilterSelection {
  if (!isRecord(value) || !isRecord(value["predicate"])) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "filter selection must contain a predicate",
    );
  }
  const predicate = value["predicate"];
  const column = predicate["column"];
  const literal = predicate["literal"];
  const operator = decodeFilterOperator(predicate["operator"]);
  const nestedColumns = new Set(
    metadata.schema.flatMap((type) => [...type.subtypes]),
  );
  if (
    typeof column !== "number" ||
    !Number.isSafeInteger(column) ||
    column < 0 ||
    metadata.schema[column] === undefined ||
    nestedColumns.has(column) ||
    typeof literal !== "string"
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "filter predicate is outside the root scalar schema",
    );
  }
  const kind = metadata.schema[column].kind;
  if (
    kind === 10 ||
    kind === 11 ||
    kind === 12 ||
    kind === 19 ||
    (operator === "contains" &&
      kind !== 7 &&
      kind !== 16 &&
      kind !== 17) ||
    (kind === 0 &&
      operator !== "eq" &&
      operator !== "ne" &&
      operator !== "isNull" &&
      operator !== "isNotNull") ||
    ((operator === "isNull" || operator === "isNotNull") &&
      literal.length !== 0)
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "filter operator is incompatible with the selected type",
    );
  }
  const cursor = value["cursor"];
  const limit = value["limit"];
  if (
    (cursor !== undefined &&
      (typeof cursor !== "string" || cursor.length === 0)) ||
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > MAX_PREVIEW_ROWS
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "filter cursor or limit is outside host bounds",
    );
  }
  return {
    predicate: { column, operator, literal },
    columns: decodeColumns(value["columns"], metadata),
    ...(cursor === undefined ? {} : { cursor }),
    limit,
  };
}

class EditorSession {
  private readonly supervisor: WorkerSupervisor;
  private source: RangeSource | undefined;
  private metadata: MetadataResult | undefined;
  private revision = 0;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  private configurationDisposable: vscode.Disposable | undefined;

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
    this.configurationDisposable =
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(
            "pixels.inspector",
            this.document.uri,
          )
        ) {
          this.postPreferences();
        }
      });
  }

  private receive(value: unknown): void {
    if (!isRecord(value)) {
      this.postError(
        new InspectorError("INVALID_MESSAGE", "webview message is invalid"),
      );
      return;
    }
    if (value["kind"] === "ready") {
      this.postPreferences();
      this.enqueue(async (revision) => {
        await this.reload(revision);
      });
      return;
    }
    if (value["kind"] === "refresh") {
      this.enqueue(async (revision) => {
        await this.reload(revision);
      });
      return;
    }
    if (value["kind"] === "cancel") {
      this.enqueue((revision) => {
        this.post({ kind: "empty", revision });
        return Promise.resolve();
      });
      return;
    }
    if (value["kind"] === "select") {
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
        const selection = decodeSelection(value, metadata);
        this.enqueue(async (revision) => {
          await this.loadSelection(revision, selection, true);
        });
      } catch (error) {
        this.postError(toInspectorError(error));
      }
      return;
    }
    if (value["kind"] === "selectRows") {
      const metadata = this.metadata;
      if (metadata === undefined) {
        this.postError(
          new InspectorError(
            "INVALID_MESSAGE",
            "metadata is not ready for row projection",
            true,
          ),
        );
        return;
      }
      try {
        const selection = decodeRowsSelection(value, metadata);
        this.enqueue(async (revision) => {
          await this.loadRows(revision, selection);
        });
      } catch (error) {
        this.postError(toInspectorError(error));
      }
      return;
    }
    if (value["kind"] === "runFilter") {
      const metadata = this.metadata;
      if (metadata === undefined) {
        this.postError(
          new InspectorError(
            "INVALID_MESSAGE",
            "metadata is not ready for filtering",
            true,
          ),
        );
        return;
      }
      try {
        const selection = decodeFilterSelection(value, metadata);
        this.enqueue(async (revision) => {
          await this.loadFilter(revision, selection);
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
    const preferences = readPreferences(this.document.uri);
    const nextSource = await this.runtime.openSource(
      this.document.uri,
      preferences.maximumVirtualFileBytes,
    );
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
      const rowCount = Math.min(firstGroup.rows, preferences.pageSize);
      if (preferences.orientation === "rows") {
        const columns = rootColumnIds(metadata).slice(0, 6);
        if (columns.length > 0) {
          await this.loadRows(
            revision,
            {
              rowGroup: 0,
              columns,
              rowOffset: 0n,
              rowCount,
            },
            false,
          );
        } else {
          this.post({ kind: "empty", revision });
        }
      } else {
        await this.loadSelection(revision, {
          rowGroup: 0,
          column: 0,
          rowOffset: 0n,
          rowCount,
        });
      }
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

  private async resetMetadata(
    revision: number,
    stage = "metadata",
  ): Promise<{
    readonly source: RangeSource;
    readonly metadata: MetadataResult;
  }> {
    const source = this.source;
    if (source === undefined) {
      throw new InspectorError("INTERNAL", "inspection source is unavailable");
    }
    await this.supervisor.restart();
    this.post({ kind: "loading", stage, revision });
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
    return { source, metadata };
  }

  private async loadRows(
    revision: number,
    selection: RowsSelection,
    resetSession = true,
  ): Promise<void> {
    const source = resetSession
      ? (await this.resetMetadata(revision, "rows")).source
      : this.source;
    if (source === undefined) {
      throw new InspectorError("INTERNAL", "inspection source is unavailable");
    }
    this.post({ kind: "loading", stage: "rowGroup", revision });
    const rowGroup = await this.supervisor.inspectRowGroup(
      source,
      selection.rowGroup,
    );
    this.requireCurrent(revision);
    this.post({ kind: "rowGroup", revision, rowGroup });
    this.post({ kind: "loading", stage: "rows", revision });
    const rows = await this.supervisor.inspectRows(source, selection);
    this.requireCurrent(revision);
    this.post({ kind: "rows", revision, rows });
  }

  private async loadFilter(
    revision: number,
    selection: FilterSelection,
  ): Promise<void> {
    const { source } = await this.resetMetadata(revision, "filter");
    this.post({ kind: "loading", stage: "filter", revision });
    const filter = await this.supervisor.inspectFilter(source, selection);
    this.requireCurrent(revision);
    this.post({ kind: "filter", revision, filter });
  }

  private postPreferences(): void {
    const preferences = readPreferences(this.document.uri);
    this.post({
      kind: "preferences",
      preferences: {
        pageSize: preferences.pageSize,
        orientation: preferences.orientation,
        timestampDisplay: preferences.timestampDisplay,
      },
    });
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
    this.configurationDisposable?.dispose();
    this.configurationDisposable = undefined;
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; font-src ${panel.webview.cspSource}; style-src ${panel.webview.cspSource}; script-src 'nonce-${token}';">
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
