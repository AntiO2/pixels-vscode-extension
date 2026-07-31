import {
  CORE_ABI_VERSION,
  MAX_FILTER_CURSOR_BYTES,
  MAX_OPERATION_ROWS,
  MAX_PROJECTION_COLUMNS,
  MAX_SCAN_CURSOR_BYTES,
  MAX_SCAN_ROWS,
} from "./constants.js";
import { InspectorError } from "./errors.js";
import { isCanonicalScanCursorV2 } from "./scan.js";

const SIGNED_DECIMAL = /^(?:0|-?[1-9][0-9]*)$/u;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const MAX_JSON_DEPTH = 64;

export type PageValue =
  | null
  | boolean
  | number
  | string
  | PageArray
  | PageObject;

export interface PageArray {
  readonly length: number;
  readonly [index: number]: PageValue;
  [Symbol.iterator](): ArrayIterator<PageValue>;
}

export interface PageObject {
  readonly [key: string]: PageValue;
}

export interface IntegerRangeStatistic {
  readonly minimum?: string;
  readonly maximum?: string;
  readonly sum?: string;
}

export interface FloatingStatistic {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly sum?: number;
}

export interface StringStatistic {
  readonly minimum?: string;
  readonly maximum?: string;
  readonly sum?: string;
}

export interface Integer128Statistic {
  readonly minimumHigh?: string;
  readonly minimumLow?: string;
  readonly maximumHigh?: string;
  readonly maximumLow?: string;
}

export interface ColumnStatistic {
  readonly numberOfValues: string;
  readonly containsNull: boolean;
  readonly integer?: IntegerRangeStatistic;
  readonly double?: FloatingStatistic;
  readonly string?: StringStatistic;
  readonly binary?: Pick<StringStatistic, "sum">;
  readonly timestamp?: IntegerRangeStatistic;
  readonly date?: IntegerRangeStatistic;
  readonly time?: IntegerRangeStatistic;
  readonly buckets?: readonly string[];
  readonly integer128?: Integer128Statistic;
}

export interface SchemaType {
  readonly id: number;
  readonly name: string;
  readonly kind: number;
  readonly subtypes: readonly number[];
  readonly maximumLength?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly dimension?: number;
}

export interface RowGroupSummary {
  readonly index: number;
  readonly footerOffset: string;
  readonly footerLength: number;
  readonly dataLength: number;
  readonly rows: number;
  readonly partition?: {
    readonly hash: number;
    readonly columns: readonly number[];
  };
}

export interface MetadataResult {
  readonly abi: number;
  readonly version: number;
  readonly magic: string;
  readonly rows: number;
  readonly pixelStride: number;
  readonly schemaCount: number;
  readonly rowGroupCount: number;
  readonly firstColumn: {
    readonly name: string;
    readonly kind: number;
  };
  readonly postscript: {
    readonly contentLength: string;
    readonly compression: number;
    readonly compressionBlockSize: number;
    readonly writerTimezone: string;
    readonly partitioned: boolean;
    readonly columnChunkAlignment: number;
    readonly hasHiddenColumn: boolean;
  };
  readonly schema: readonly SchemaType[];
  readonly fileStatistics: readonly ColumnStatistic[];
  readonly rowGroups: readonly RowGroupSummary[];
  readonly rowGroupStatistics: readonly (readonly ColumnStatistic[])[];
}

export interface RowGroupColumn {
  readonly column: number;
  readonly encoding: {
    readonly kind: number;
    readonly dictionarySize?: number;
    readonly cascadeKind?: number;
  };
  readonly chunk: {
    readonly offset: string;
    readonly length: number;
    readonly nullOffset: number;
    readonly littleEndian: boolean;
    readonly nullsPadding: boolean;
    readonly nullAlignment: number;
    readonly pixels: readonly {
      readonly index: number;
      readonly position: number;
      readonly statistics: ColumnStatistic | null;
    }[];
  };
}

export interface RowGroupResult {
  readonly rowGroup: number;
  readonly columns: readonly RowGroupColumn[];
}

export interface PageResult {
  readonly rowGroup: number;
  readonly column: number;
  readonly offset: number;
  readonly count: number;
  readonly values: readonly PageValue[];
}

export interface ProjectedColumn {
  readonly id: number;
  readonly name: string;
  readonly kind: number;
}

export interface ProjectedRow {
  readonly rowGroup: number;
  readonly localRow: string;
  readonly absoluteRow: string;
  readonly values: readonly PageValue[];
}

export interface RowsResult {
  readonly operation: "rows-v1";
  readonly rowGroup: number;
  readonly offset: string;
  readonly count: number;
  readonly columns: readonly ProjectedColumn[];
  readonly rows: readonly ProjectedRow[];
}

export interface FilterProgress {
  readonly scannedRowGroups: number;
  readonly prunedRowGroups: number;
  readonly scannedRows: string;
  readonly prunedRows: string;
}

export interface FilterResult {
  readonly operation: "filter-v1";
  readonly columns: readonly ProjectedColumn[];
  readonly rows: readonly ProjectedRow[];
  readonly progress: FilterProgress;
  readonly matched: number;
  readonly completed: boolean;
  readonly truncated: boolean;
  readonly cursor: string | null;
}

export interface ScanResultProgressV2 {
  readonly rowGroupsTotal: number;
  readonly rowGroupsConsidered: number;
  readonly scannedRowGroups: number;
  readonly prunedRowGroups: number;
  readonly rowsTotal: string;
  readonly scannedRows: string;
  readonly prunedRows: string;
  readonly matchedRows: string;
}

export interface ScanResultV2 {
  readonly operation: "scan-v2";
  readonly columns: readonly ProjectedColumn[];
  readonly rows: readonly ProjectedRow[];
  readonly page: {
    readonly offsetApplied: string;
    readonly limit: number;
    readonly returned: number;
    readonly continuationAvailable: boolean;
    readonly hasMoreExact: boolean;
    readonly cursor: string | null;
  };
  readonly scan: {
    readonly ordered: boolean;
    readonly completion: "complete" | "limit";
  };
  readonly progress: ScanResultProgressV2;
}

function fail(message: string): never {
  throw new InspectorError("INVALID_MESSAGE", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(`${field} must be an object`);
  }
  return value;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    fail(`${field} must be an array`);
  }
  return value;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") {
    fail(`${field} must be a string`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${field} must be boolean`);
  }
  return value;
}

function integer(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    fail(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function decimal(
  value: unknown,
  field: string,
  unsigned = false,
): string {
  const decoded = string(value, field);
  const pattern = unsigned ? UNSIGNED_DECIMAL : SIGNED_DECIMAL;
  if (!pattern.test(decoded)) {
    fail(`${field} must be a canonical decimal string`);
  }
  return decoded;
}

function optional<T>(
  value: Record<string, unknown>,
  field: string,
  decode: (candidate: unknown, path: string) => T,
  path: string,
): T | undefined {
  const candidate = value[field];
  return candidate === undefined
    ? undefined
    : decode(candidate, `${path}.${field}`);
}

type WithoutUndefined<T extends object> = {
  [Key in keyof T as undefined extends T[Key] ? never : Key]: T[Key];
} & {
  [Key in keyof T as undefined extends T[Key] ? Key : never]?:
    Exclude<T[Key], undefined>;
};

function compact<T extends object>(value: T): WithoutUndefined<T> {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as WithoutUndefined<T>;
}

function decodeIntegerRange(
  value: unknown,
  path: string,
): IntegerRangeStatistic {
  const source = record(value, path);
  return compact({
    minimum: optional(source, "minimum", decimal, path),
    maximum: optional(source, "maximum", decimal, path),
    sum: optional(source, "sum", decimal, path),
  });
}

function decodeFloating(
  value: unknown,
  path: string,
): FloatingStatistic {
  const source = record(value, path);
  const finite = (candidate: unknown, field: string): number => {
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
      fail(`${field} must be a finite number`);
    }
    return candidate;
  };
  return compact({
    minimum: optional(source, "minimum", finite, path),
    maximum: optional(source, "maximum", finite, path),
    sum: optional(source, "sum", finite, path),
  });
}

function decodeStringStatistic(
  value: unknown,
  path: string,
): StringStatistic {
  const source = record(value, path);
  return compact({
    minimum: optional(source, "minimum", string, path),
    maximum: optional(source, "maximum", string, path),
    sum: optional(
      source,
      "sum",
      (candidate, field) => decimal(candidate, field, true),
      path,
    ),
  });
}

function decodeColumnStatistic(
  value: unknown,
  path: string,
): ColumnStatistic {
  const source = record(value, path);
  const buckets = optional(
    source,
    "buckets",
    (candidate, field) =>
      array(candidate, field).map((item, index) =>
        decimal(item, `${field}[${String(index)}]`, true),
      ),
    path,
  );
  const binary = optional(
    source,
    "binary",
    (candidate, field) => {
      const binarySource = record(candidate, field);
      return compact({
        sum: optional(
          binarySource,
          "sum",
          (item, itemField) => decimal(item, itemField, true),
          field,
        ),
      });
    },
    path,
  );
  const integer128 = optional(
    source,
    "integer128",
    (candidate, field): Integer128Statistic => {
      const integer128Source = record(candidate, field);
      return compact({
        minimumHigh: optional(
          integer128Source,
          "minimumHigh",
          decimal,
          field,
        ),
        minimumLow: optional(
          integer128Source,
          "minimumLow",
          (item, itemField) => decimal(item, itemField, true),
          field,
        ),
        maximumHigh: optional(
          integer128Source,
          "maximumHigh",
          decimal,
          field,
        ),
        maximumLow: optional(
          integer128Source,
          "maximumLow",
          (item, itemField) => decimal(item, itemField, true),
          field,
        ),
      });
    },
    path,
  );
  return compact({
    numberOfValues: decimal(
      source["numberOfValues"],
      `${path}.numberOfValues`,
      true,
    ),
    containsNull: boolean(source["containsNull"], `${path}.containsNull`),
    integer: optional(source, "integer", decodeIntegerRange, path),
    double: optional(source, "double", decodeFloating, path),
    string: optional(source, "string", decodeStringStatistic, path),
    binary,
    timestamp: optional(source, "timestamp", decodeIntegerRange, path),
    date: optional(source, "date", decodeIntegerRange, path),
    time: optional(source, "time", decodeIntegerRange, path),
    buckets,
    integer128,
  });
}

function parseJson(json: string, operation: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch (error) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      `Core ${operation} result is not valid JSON`,
      false,
      { cause: error },
    );
  }
}

export function decodeMetadataResult(value: unknown): MetadataResult {
  const source = record(value, "metadata");
  const schema = array(source["schema"], "metadata.schema").map(
    (item, index): SchemaType => {
      const path = `metadata.schema[${String(index)}]`;
      const type = record(item, path);
      return compact({
        id: integer(type["id"], `${path}.id`),
        name: string(type["name"], `${path}.name`),
        kind: integer(type["kind"], `${path}.kind`),
        subtypes: array(type["subtypes"], `${path}.subtypes`).map(
          (child, childIndex) =>
            integer(child, `${path}.subtypes[${String(childIndex)}]`),
        ),
        maximumLength: optional(type, "maximumLength", integer, path),
        precision: optional(type, "precision", integer, path),
        scale: optional(type, "scale", integer, path),
        dimension: optional(type, "dimension", integer, path),
      });
    },
  );
  const rowGroups = array(source["rowGroups"], "metadata.rowGroups").map(
    (item, index): RowGroupSummary => {
      const path = `metadata.rowGroups[${String(index)}]`;
      const rowGroup = record(item, path);
      const partition = optional(
        rowGroup,
        "partition",
        (candidate, field) => {
          const partitionSource = record(candidate, field);
          return {
            hash: integer(partitionSource["hash"], `${field}.hash`),
            columns: array(
              partitionSource["columns"],
              `${field}.columns`,
            ).map((column, columnIndex) =>
              integer(
                column,
                `${field}.columns[${String(columnIndex)}]`,
              ),
            ),
          };
        },
        path,
      );
      return compact({
        index: integer(rowGroup["index"], `${path}.index`),
        footerOffset: decimal(
          rowGroup["footerOffset"],
          `${path}.footerOffset`,
          true,
        ),
        footerLength: integer(
          rowGroup["footerLength"],
          `${path}.footerLength`,
        ),
        dataLength: integer(
          rowGroup["dataLength"],
          `${path}.dataLength`,
        ),
        rows: integer(rowGroup["rows"], `${path}.rows`),
        partition,
      });
    },
  );
  const firstColumn = record(source["firstColumn"], "metadata.firstColumn");
  const postscript = record(source["postscript"], "metadata.postscript");
  const fileStatistics = array(
    source["fileStatistics"],
    "metadata.fileStatistics",
  ).map((item, index) =>
    decodeColumnStatistic(
      item,
      `metadata.fileStatistics[${String(index)}]`,
    ),
  );
  const rowGroupStatistics = array(
    source["rowGroupStatistics"],
    "metadata.rowGroupStatistics",
  ).map((group, groupIndex) =>
    array(
      group,
      `metadata.rowGroupStatistics[${String(groupIndex)}]`,
    ).map((item, columnIndex) =>
      decodeColumnStatistic(
        item,
        `metadata.rowGroupStatistics[${String(groupIndex)}][${String(columnIndex)}]`,
      ),
    ),
  );
  const result: MetadataResult = {
    abi: integer(source["abi"], "metadata.abi"),
    version: integer(source["version"], "metadata.version"),
    magic: string(source["magic"], "metadata.magic"),
    rows: integer(source["rows"], "metadata.rows"),
    pixelStride: integer(source["pixelStride"], "metadata.pixelStride"),
    schemaCount: integer(source["schemaCount"], "metadata.schemaCount"),
    rowGroupCount: integer(
      source["rowGroupCount"],
      "metadata.rowGroupCount",
    ),
    firstColumn: {
      name: string(firstColumn["name"], "metadata.firstColumn.name"),
      kind: integer(firstColumn["kind"], "metadata.firstColumn.kind"),
    },
    postscript: {
      contentLength: decimal(
        postscript["contentLength"],
        "metadata.postscript.contentLength",
        true,
      ),
      compression: integer(
        postscript["compression"],
        "metadata.postscript.compression",
      ),
      compressionBlockSize: integer(
        postscript["compressionBlockSize"],
        "metadata.postscript.compressionBlockSize",
      ),
      writerTimezone: string(
        postscript["writerTimezone"],
        "metadata.postscript.writerTimezone",
      ),
      partitioned: boolean(
        postscript["partitioned"],
        "metadata.postscript.partitioned",
      ),
      columnChunkAlignment: integer(
        postscript["columnChunkAlignment"],
        "metadata.postscript.columnChunkAlignment",
      ),
      hasHiddenColumn: boolean(
        postscript["hasHiddenColumn"],
        "metadata.postscript.hasHiddenColumn",
      ),
    },
    schema,
    fileStatistics,
    rowGroups,
    rowGroupStatistics,
  };
  if (
    result.abi !== CORE_ABI_VERSION ||
    result.schemaCount !== schema.length ||
    result.rowGroupCount !== rowGroups.length ||
    fileStatistics.length !== schema.length ||
    rowGroupStatistics.length !== rowGroups.length ||
    rowGroupStatistics.some((statistics) => statistics.length !== schema.length)
  ) {
    fail("metadata result counts or ABI are inconsistent");
  }
  return result;
}

export function decodeRowGroupResult(value: unknown): RowGroupResult {
  const source = record(value, "rowGroup");
  return {
    rowGroup: integer(source["rowGroup"], "rowGroup.rowGroup"),
    columns: array(source["columns"], "rowGroup.columns").map(
      (item, index): RowGroupColumn => {
        const path = `rowGroup.columns[${String(index)}]`;
        const column = record(item, path);
        const encoding = record(column["encoding"], `${path}.encoding`);
        const chunk = record(column["chunk"], `${path}.chunk`);
        return {
          column: integer(column["column"], `${path}.column`),
          encoding: compact({
            kind: integer(encoding["kind"], `${path}.encoding.kind`),
            dictionarySize: optional(
              encoding,
              "dictionarySize",
              integer,
              `${path}.encoding`,
            ),
            cascadeKind: optional(
              encoding,
              "cascadeKind",
              integer,
              `${path}.encoding`,
            ),
          }),
          chunk: {
            offset: decimal(
              chunk["offset"],
              `${path}.chunk.offset`,
              true,
            ),
            length: integer(chunk["length"], `${path}.chunk.length`),
            nullOffset: integer(
              chunk["nullOffset"],
              `${path}.chunk.nullOffset`,
            ),
            littleEndian: boolean(
              chunk["littleEndian"],
              `${path}.chunk.littleEndian`,
            ),
            nullsPadding: boolean(
              chunk["nullsPadding"],
              `${path}.chunk.nullsPadding`,
            ),
            nullAlignment: integer(
              chunk["nullAlignment"],
              `${path}.chunk.nullAlignment`,
            ),
            pixels: array(chunk["pixels"], `${path}.chunk.pixels`).map(
              (pixelValue, pixelIndex) => {
                const pixelPath =
                  `${path}.chunk.pixels[${String(pixelIndex)}]`;
                const pixel = record(pixelValue, pixelPath);
                return {
                  index: integer(pixel["index"], `${pixelPath}.index`),
                  position: integer(
                    pixel["position"],
                    `${pixelPath}.position`,
                  ),
                  statistics:
                    pixel["statistics"] === null
                      ? null
                      : decodeColumnStatistic(
                          pixel["statistics"],
                          `${pixelPath}.statistics`,
                        ),
                };
              },
            ),
          },
        };
      },
    ),
  };
}

function decodePageValue(
  value: unknown,
  path: string,
  depth: number,
): PageValue {
  if (depth > MAX_JSON_DEPTH) {
    fail(`${path} exceeds the maximum nesting depth`);
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(`${path} must be a finite number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      decodePageValue(item, `${path}[${String(index)}]`, depth + 1),
    );
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        decodePageValue(item, `${path}.${key}`, depth + 1),
      ]),
    );
  }
  return fail(`${path} contains an unsupported JSON value`);
}

export function decodePageResult(value: unknown): PageResult {
  const source = record(value, "page");
  const values = array(source["values"], "page.values").map((item, index) =>
    decodePageValue(item, `page.values[${String(index)}]`, 0),
  );
  const result: PageResult = {
    rowGroup: integer(source["rowGroup"], "page.rowGroup"),
    column: integer(source["column"], "page.column"),
    offset: integer(source["offset"], "page.offset"),
    count: integer(source["count"], "page.count"),
    values,
  };
  if (result.count !== values.length) {
    fail("page count does not match its value count");
  }
  return result;
}

function decodeProjectedColumns(
  value: unknown,
  path: string,
): readonly ProjectedColumn[] {
  const decoded = array(value, path).map((item, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const column = record(item, itemPath);
    return {
      id: integer(column["id"], `${itemPath}.id`),
      name: string(column["name"], `${itemPath}.name`),
      kind: integer(column["kind"], `${itemPath}.kind`),
    };
  });
  if (
    decoded.length === 0 ||
    decoded.length > MAX_PROJECTION_COLUMNS ||
    new Set(decoded.map((column) => column.id)).size !== decoded.length ||
    decoded.some((column) => column.id > 0xffff_ffff || column.kind >= 20)
  ) {
    fail(`${path} must contain unique projected columns`);
  }
  return decoded;
}

function decodeProjectedRows(
  value: unknown,
  path: string,
  columnCount: number,
): readonly ProjectedRow[] {
  return array(value, path).map((item, index) => {
    const itemPath = `${path}[${String(index)}]`;
    const row = record(item, itemPath);
    const values = array(row["values"], `${itemPath}.values`).map(
      (candidate, valueIndex) =>
        decodePageValue(
          candidate,
          `${itemPath}.values[${String(valueIndex)}]`,
          0,
        ),
    );
    if (values.length !== columnCount) {
      fail(`${itemPath}.values does not match projected columns`);
    }
    return {
      rowGroup: integer(row["rowGroup"], `${itemPath}.rowGroup`),
      localRow: decimal(row["localRow"], `${itemPath}.localRow`, true),
      absoluteRow: decimal(
        row["absoluteRow"],
        `${itemPath}.absoluteRow`,
        true,
      ),
      values,
    };
  });
}

export function decodeRowsResult(value: unknown): RowsResult {
  const source = record(value, "rows");
  if (source["operation"] !== "rows-v1") {
    fail("rows.operation must be rows-v1");
  }
  const columns = decodeProjectedColumns(source["columns"], "rows.columns");
  const rows = decodeProjectedRows(
    source["rows"],
    "rows.rows",
    columns.length,
  );
  const result: RowsResult = {
    operation: "rows-v1",
    rowGroup: integer(source["rowGroup"], "rows.rowGroup"),
    offset: decimal(source["offset"], "rows.offset", true),
    count: integer(source["count"], "rows.count"),
    columns,
    rows,
  };
  if (
    result.count !== rows.length ||
    result.count === 0 ||
    result.count > MAX_OPERATION_ROWS
  ) {
    fail("rows count is outside bounds or does not match row values");
  }
  if (
    rows.some((row, index) => {
      const localRow = BigInt(result.offset) + BigInt(index);
      const absoluteRow =
        BigInt(rows[0]?.absoluteRow ?? "0") + BigInt(index);
      return (
        row.rowGroup !== result.rowGroup ||
        BigInt(row.localRow) !== localRow ||
        BigInt(row.absoluteRow) !== absoluteRow
      );
    })
  ) {
    fail("rows identities are inconsistent with the requested page");
  }
  return result;
}

export function decodeFilterResult(value: unknown): FilterResult {
  const source = record(value, "filter");
  if (source["operation"] !== "filter-v1") {
    fail("filter.operation must be filter-v1");
  }
  const columns = decodeProjectedColumns(
    source["columns"],
    "filter.columns",
  );
  const rows = decodeProjectedRows(
    source["rows"],
    "filter.rows",
    columns.length,
  );
  const progressValue = record(source["progress"], "filter.progress");
  const cursorValue = source["cursor"];
  if (
    cursorValue !== null &&
    (typeof cursorValue !== "string" ||
      cursorValue.length === 0 ||
      new TextEncoder().encode(cursorValue).byteLength >
        MAX_FILTER_CURSOR_BYTES)
  ) {
    fail("filter.cursor must be null or a non-empty string");
  }
  const result: FilterResult = {
    operation: "filter-v1",
    columns,
    rows,
    progress: {
      scannedRowGroups: integer(
        progressValue["scannedRowGroups"],
        "filter.progress.scannedRowGroups",
      ),
      prunedRowGroups: integer(
        progressValue["prunedRowGroups"],
        "filter.progress.prunedRowGroups",
      ),
      scannedRows: decimal(
        progressValue["scannedRows"],
        "filter.progress.scannedRows",
        true,
      ),
      prunedRows: decimal(
        progressValue["prunedRows"],
        "filter.progress.prunedRows",
        true,
      ),
    },
    matched: integer(source["matched"], "filter.matched"),
    completed: boolean(source["completed"], "filter.completed"),
    truncated: boolean(source["truncated"], "filter.truncated"),
    cursor: cursorValue,
  };
  if (
    result.matched !== rows.length ||
    result.matched > MAX_OPERATION_ROWS
  ) {
    fail("filter matched count is outside bounds or inconsistent");
  }
  if (
    rows.some(
      (row, index) =>
        index > 0 &&
        BigInt(row.absoluteRow) <=
          BigInt(rows[index - 1]?.absoluteRow ?? "0"),
    )
  ) {
    fail("filter rows must have strictly increasing identities");
  }
  if (result.truncated === result.completed) {
    fail("filter completed and truncated states are inconsistent");
  }
  if (result.completed && result.cursor !== null) {
    fail("completed filter result cannot include a cursor");
  }
  if (!result.completed && result.cursor === null) {
    fail("incomplete filter result must include a cursor");
  }
  return result;
}

export function decodeScanResultV2(value: unknown): ScanResultV2 {
  const source = record(value, "scan");
  if (source["operation"] !== "scan-v2") {
    fail("scan.operation must be scan-v2");
  }
  const columns = decodeProjectedColumns(source["columns"], "scan.columns");
  const rows = decodeProjectedRows(source["rows"], "scan.rows", columns.length);
  const pageValue = record(source["page"], "scan.page");
  const scanValue = record(source["scan"], "scan.scan");
  const progressValue = record(source["progress"], "scan.progress");
  const completion = scanValue["completion"];
  if (completion !== "complete" && completion !== "limit") {
    fail("scan.scan.completion is invalid");
  }
  const cursorValue = pageValue["cursor"];
  if (
    cursorValue !== null &&
    (typeof cursorValue !== "string" ||
      cursorValue.length === 0 ||
      !isCanonicalScanCursorV2(cursorValue) ||
      new TextEncoder().encode(cursorValue).byteLength > MAX_SCAN_CURSOR_BYTES)
  ) {
    fail("scan.page.cursor must be null or bounded base64url");
  }
  const page = {
    offsetApplied: decimal(
      pageValue["offsetApplied"],
      "scan.page.offsetApplied",
      true,
    ),
    limit: integer(pageValue["limit"], "scan.page.limit"),
    returned: integer(pageValue["returned"], "scan.page.returned"),
    continuationAvailable: boolean(
      pageValue["continuationAvailable"],
      "scan.page.continuationAvailable",
    ),
    hasMoreExact: boolean(
      pageValue["hasMoreExact"],
      "scan.page.hasMoreExact",
    ),
    cursor: cursorValue,
  };
  if (typeof scanValue["ordered"] !== "boolean") {
    fail("scan.scan.ordered must be boolean");
  }
  const progress: ScanResultProgressV2 = {
    rowGroupsTotal: integer(
      progressValue["rowGroupsTotal"],
      "scan.progress.rowGroupsTotal",
    ),
    rowGroupsConsidered: integer(
      progressValue["rowGroupsConsidered"],
      "scan.progress.rowGroupsConsidered",
    ),
    scannedRowGroups: integer(
      progressValue["scannedRowGroups"],
      "scan.progress.scannedRowGroups",
    ),
    prunedRowGroups: integer(
      progressValue["prunedRowGroups"],
      "scan.progress.prunedRowGroups",
    ),
    rowsTotal: decimal(
      progressValue["rowsTotal"],
      "scan.progress.rowsTotal",
      true,
    ),
    scannedRows: decimal(
      progressValue["scannedRows"],
      "scan.progress.scannedRows",
      true,
    ),
    prunedRows: decimal(
      progressValue["prunedRows"],
      "scan.progress.prunedRows",
      true,
    ),
    matchedRows: decimal(
      progressValue["matchedRows"],
      "scan.progress.matchedRows",
      true,
    ),
  };
  const result: ScanResultV2 = {
    operation: "scan-v2",
    columns,
    rows,
    page,
    scan: {
      ordered: scanValue["ordered"],
      completion,
    },
    progress,
  };
  if (
    page.limit < 1 ||
    page.limit > MAX_SCAN_ROWS ||
    page.returned !== rows.length ||
    page.returned > page.limit
  ) {
    fail("scan page count is outside bounds or inconsistent");
  }
  const identities = new Set(
    rows.map(
      (row) => `${String(row.rowGroup)}:${row.localRow}:${row.absoluteRow}`,
    ),
  );
  if (identities.size !== rows.length) {
    fail("scan rows must have unique identities");
  }
  if (
    !result.scan.ordered &&
    rows.some(
      (row, index) =>
        index > 0 &&
        BigInt(row.absoluteRow) <=
          BigInt(rows[index - 1]?.absoluteRow ?? "0"),
    )
  ) {
    fail("natural scan rows must have strictly increasing identities");
  }
  if (
    progress.rowGroupsConsidered > progress.rowGroupsTotal ||
    progress.scannedRowGroups + progress.prunedRowGroups >
      progress.rowGroupsConsidered ||
    BigInt(progress.scannedRows) + BigInt(progress.prunedRows) >
      BigInt(progress.rowsTotal) ||
    BigInt(progress.matchedRows) > BigInt(progress.scannedRows)
  ) {
    fail("scan progress counters are inconsistent");
  }
  if (
    page.continuationAvailable !== (page.cursor !== null) ||
    (completion === "complete" && !result.scan.ordered &&
      page.continuationAvailable)
  ) {
    fail("scan completion and continuation fields are inconsistent");
  }
  return result;
}

export function decodeMetadataResultJson(json: string): MetadataResult {
  return decodeMetadataResult(parseJson(json, "metadata"));
}

export function decodeRowGroupResultJson(json: string): RowGroupResult {
  return decodeRowGroupResult(parseJson(json, "row-group"));
}

export function decodePageResultJson(json: string): PageResult {
  return decodePageResult(parseJson(json, "page"));
}

export function decodeRowsResultJson(json: string): RowsResult {
  return decodeRowsResult(parseJson(json, "rows"));
}

export function decodeFilterResultJson(json: string): FilterResult {
  return decodeFilterResult(parseJson(json, "filter"));
}

export function decodeScanResultV2Json(json: string): ScanResultV2 {
  return decodeScanResultV2(parseJson(json, "scan"));
}
