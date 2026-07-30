import { CORE_ABI_VERSION } from "./constants.js";
import { InspectorError } from "./errors.js";

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

export function decodeMetadataResultJson(json: string): MetadataResult {
  return decodeMetadataResult(parseJson(json, "metadata"));
}

export function decodeRowGroupResultJson(json: string): RowGroupResult {
  return decodeRowGroupResult(parseJson(json, "row-group"));
}

export function decodePageResultJson(json: string): PageResult {
  return decodePageResult(parseJson(json, "page"));
}
