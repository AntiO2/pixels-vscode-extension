import * as vscode from "vscode";

import {
  InspectorError,
  MAX_PROJECTION_COLUMNS,
  decodeScanPlanV2,
  parseUnsignedDecimal,
  toInspectorError,
} from "@pixels-inspector/protocol-client";
import type {
  CoreManifest,
  FilterOperator,
  MetadataResult,
  ScanExpressionV2,
  ScanPlanV2,
} from "@pixels-inspector/protocol-client";

import type { RangeSource } from "./sources/range-source.js";
import { ColumnPageCache } from "./data/column-page-cache.js";
import type { ColumnPageKey } from "./data/column-page-cache.js";
import type { WorkerFactory } from "./worker/transport.js";
import { ScanProgressClock } from "./worker/scan-progress-clock.js";
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

export class PixelsDocument implements vscode.CustomDocument {
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

interface ScanSelection {
  readonly plan: ScanPlanV2;
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

const SCAN_SCALAR_KINDS = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 9, 14, 15, 16, 17, 18,
]);

function validateScanExpression(
  expression: ScanExpressionV2,
  metadata: MetadataResult,
  rootColumns: ReadonlySet<number>,
): void {
  switch (expression.kind) {
    case "and":
    case "or":
      expression.children.forEach((child) => {
        validateScanExpression(child, metadata, rootColumns);
      });
      return;
    case "not":
      validateScanExpression(expression.child, metadata, rootColumns);
      return;
    case "predicate": {
      const type = metadata.schema.find(
        (candidate) => candidate.id === expression.column,
      );
      if (
        type === undefined ||
        !rootColumns.has(expression.column) ||
        !SCAN_SCALAR_KINDS.has(type.kind) ||
        (expression.operator === "contains" &&
          type.kind !== 7 &&
          type.kind !== 16 &&
          type.kind !== 17) ||
        (type.kind === 0 &&
          expression.operator !== "eq" &&
          expression.operator !== "ne" &&
          expression.operator !== "isNull" &&
          expression.operator !== "isNotNull")
      ) {
        throw new InspectorError(
          "INVALID_MESSAGE",
          "scan predicate is incompatible with the root scalar schema",
        );
      }
    }
  }
}

export function decodeScanSelection(
  value: unknown,
  metadata: MetadataResult,
): ScanSelection {
  if (!isRecord(value)) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "scan selection must be an object",
    );
  }
  const plan = decodeScanPlanV2(value["plan"]);
  const rootColumns = new Set(rootColumnIds(metadata));
  if (
    plan.projection.kind === "all" &&
    rootColumns.size > MAX_PROJECTION_COLUMNS
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "scan all projection exceeds the root column bound",
    );
  }
  if (
    plan.projection.kind === "columns" &&
    plan.projection.columns.some((column) => !rootColumns.has(column))
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "scan projection contains a non-root schema column",
    );
  }
  if (plan.predicate !== undefined) {
    validateScanExpression(plan.predicate, metadata, rootColumns);
  }
  if (
    plan.orderBy.some((key) => {
      const type = metadata.schema.find(
        (candidate) => candidate.id === key.column,
      );
      return (
        type === undefined ||
        !rootColumns.has(key.column) ||
        !SCAN_SCALAR_KINDS.has(type.kind)
      );
    })
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "scan order key is incompatible with the root scalar schema",
    );
  }
  return { plan };
}

export class EditorSession {
  private readonly supervisor: WorkerSupervisor;
  private readonly columnPageCache = new ColumnPageCache();
  private source: RangeSource | undefined;
  private metadata: MetadataResult | undefined;
  private metadataGeneration: number | undefined;
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
        this.post({
          // Cancel is a Query-only webview action. Report it as cancelled even
          // when it supersedes a scan that is still queued and has not begun;
          // otherwise the reducer can remain stuck running.
          kind: "scanCancelled",
          revision,
        });
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
    if (value["kind"] === "runScan") {
      const metadata = this.metadata;
      if (metadata === undefined) {
        this.postError(
          new InspectorError(
            "INVALID_MESSAGE",
            "metadata is not ready for scanning",
            true,
          ),
        );
        return;
      }
      try {
        const selection = decodeScanSelection(value, metadata);
        this.enqueue(async (revision) => {
          await this.loadScan(revision, selection);
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
    const preferences = readPreferences(this.document.uri);
    const nextSource = await this.runtime.openSource(
      this.document.uri,
      preferences.maximumVirtualFileBytes,
    );
    let accepted = false;
    try {
      this.requireCurrent(revision);
      await this.supervisor.restart();
      this.post({ kind: "loading", stage: "metadata", revision });
      const metadata = await this.supervisor.inspectMetadata(nextSource);
      this.requireCurrent(revision);

      const previousSource = this.source;
      await previousSource?.close();
      this.source = nextSource;
      accepted = true;
      this.columnPageCache.clear();
      this.metadata = metadata;
      this.metadataGeneration = this.supervisor.metrics.generations;

      this.post({
        kind: "metadata",
        revision,
        source: {
          uri: nextSource.identity.uri,
          size: nextSource.size.toString(),
          revision: nextSource.identity.revision,
        },
        capabilities: this.supervisor.capabilities,
        metadata,
      });
    } catch (error) {
      if (!accepted) {
        await nextSource.close();
      }
      throw error;
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
      this.metadataGeneration = this.supervisor.metrics.generations;
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
    if (
      this.metadata !== undefined &&
      JSON.stringify(this.metadata.schema) !== JSON.stringify(metadata.schema)
    ) {
      this.columnPageCache.clear();
    }
    this.metadata = metadata;
    this.metadataGeneration = this.supervisor.metrics.generations;
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
  ): Promise<void> {
    const source = this.source;
    if (source === undefined) {
      throw new InspectorError("INTERNAL", "inspection source is unavailable");
    }
    const key: ColumnPageKey = {
      sourceRevision: source.identity.revision,
      rowGroup: selection.rowGroup,
      offset: selection.rowOffset.toString(),
      count: selection.rowCount,
    };
    const cached = this.columnPageCache.assemble(key, selection.columns);
    if (cached !== undefined) {
      this.requireCurrent(revision);
      this.post({ kind: "rows", revision, rows: cached });
      return;
    }
    await this.ensureMetadataSession(revision);
    this.requireCurrent(revision);
    const missing = this.columnPageCache.missingColumns(
      key,
      selection.columns,
    );
    if (missing.length === 0) {
      const assembled = this.columnPageCache.assemble(key, selection.columns);
      if (assembled === undefined) {
        throw new InspectorError(
          "INTERNAL",
          "column cache could not assemble a complete projection",
        );
      }
      this.post({ kind: "rows", revision, rows: assembled });
      return;
    }
    this.post({ kind: "loading", stage: "rows", revision });
    const fragment = await this.supervisor.inspectRows(source, {
      ...selection,
      columns: missing,
    });
    this.requireCurrent(revision);
    if (source !== this.source || source.identity.revision !== key.sourceRevision) {
      throw new InspectorError(
        "CANCELLED",
        "column fragment belongs to a stale source",
        true,
      );
    }
    const rows = this.columnPageCache.mergeAndAssemble(
      key,
      fragment,
      selection.columns,
    );
    this.post({ kind: "rows", revision, rows });
  }

  private async ensureMetadataSession(revision: number): Promise<void> {
    const source = this.source;
    if (source === undefined) {
      throw new InspectorError("INTERNAL", "inspection source is unavailable");
    }
    if (
      this.metadata !== undefined &&
      this.metadataGeneration === this.supervisor.metrics.generations
    ) {
      return;
    }
    this.post({ kind: "loading", stage: "metadata", revision });
    const metadata = await this.supervisor.inspectMetadata(source);
    this.requireCurrent(revision);
    if (
      this.metadata !== undefined &&
      JSON.stringify(this.metadata.schema) !== JSON.stringify(metadata.schema)
    ) {
      this.columnPageCache.clear();
    }
    this.metadata = metadata;
    this.metadataGeneration = this.supervisor.metrics.generations;
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

  private async loadScan(
    revision: number,
    selection: ScanSelection,
  ): Promise<void> {
    const { source } = await this.resetMetadata(revision, "scan");
    this.post({ kind: "loading", stage: "scan", revision });
    const clock = new ScanProgressClock((update) => {
      if (!this.disposed && revision === this.revision) {
        this.post({
          kind: "scanProgress",
          revision,
          ...update,
        });
      }
    });
    try {
      const scan = await this.supervisor.inspectScan(
        source,
        selection.plan,
        (progress) => {
          clock.update(progress);
        },
      );
      this.requireCurrent(revision);
      this.post({
        kind: "scan",
        revision,
        scan,
        elapsedMs: clock.elapsedMs,
      });
    } finally {
      clock.stop();
    }
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
    this.columnPageCache.clear();
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
