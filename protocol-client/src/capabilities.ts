import {
  CORE_ABI_VERSION,
  DEFAULT_FILTER_ROWS,
  MAX_OPERATION_ROWS,
} from "./constants.js";
import { InspectorError } from "./errors.js";

const TYPE_NAMES = Object.freeze([
  "BOOLEAN",
  "BYTE",
  "SHORT",
  "INT",
  "LONG",
  "FLOAT",
  "DOUBLE",
  "STRING",
  "BINARY",
  "TIMESTAMP",
  "ARRAY",
  "MAP",
  "STRUCT",
  "VARBINARY",
  "DECIMAL",
  "DATE",
  "VARCHAR",
  "CHAR",
  "TIME",
  "VECTOR",
] as const);

const ENCODINGS = Object.freeze([
  "NONE",
  "RUNLENGTH",
  "DICTIONARY",
] as const);

const COMPRESSION_METADATA = Object.freeze([
  "NONE",
  "ZLIB",
  "SNAPPY",
  "LZO",
  "LZ4",
  "ZSTD",
] as const);

export interface CoreTypeCapability {
  readonly kind: number;
  readonly name: string;
}

export interface CoreCapabilities {
  readonly abi: number;
  readonly page: "generic-v1";
  readonly rows: "rows-v1";
  readonly filter: "filter-v1";
  readonly rowGroup: "layout-v1";
  readonly maxRows: typeof MAX_OPERATION_ROWS;
  readonly defaultRows: typeof DEFAULT_FILTER_ROWS;
  readonly types: readonly CoreTypeCapability[];
  readonly encodings: typeof ENCODINGS;
  readonly compression: {
    readonly metadata: typeof COMPRESSION_METADATA;
    readonly payload: "inactive";
    readonly reason: "postscript-v1-unused";
  };
  readonly nested: "portable-v1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeCoreCapabilities(value: unknown): CoreCapabilities {
  if (!isRecord(value)) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "Core capabilities must be an object",
    );
  }
  const types = value["types"];
  const encodings = value["encodings"];
  const compression = value["compression"];
  if (
    value["abi"] !== CORE_ABI_VERSION ||
    value["page"] !== "generic-v1" ||
    value["rows"] !== "rows-v1" ||
    value["filter"] !== "filter-v1" ||
    value["rowGroup"] !== "layout-v1" ||
    value["maxRows"] !== MAX_OPERATION_ROWS ||
    value["defaultRows"] !== DEFAULT_FILTER_ROWS ||
    value["nested"] !== "portable-v1" ||
    !Array.isArray(types) ||
    types.length !== TYPE_NAMES.length ||
    !Array.isArray(encodings) ||
    encodings.length !== ENCODINGS.length ||
    !ENCODINGS.every((encoding, index) => encodings[index] === encoding) ||
    !isRecord(compression) ||
    JSON.stringify(compression["metadata"]) !==
      JSON.stringify(COMPRESSION_METADATA) ||
    compression["payload"] !== "inactive" ||
    compression["reason"] !== "postscript-v1-unused"
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      "Core capabilities are incomplete",
    );
  }

  const decodedTypes: CoreTypeCapability[] = [];
  for (let index = 0; index < types.length; index += 1) {
    const type: unknown = types[index];
    const expectedName = TYPE_NAMES[index];
    if (
      !isRecord(type) ||
      type["kind"] !== index ||
      type["name"] !== expectedName ||
      expectedName === undefined
    ) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "Core type capabilities are invalid",
      );
    }
    decodedTypes.push({
      kind: index,
      name: expectedName,
    });
  }
  return {
    abi: CORE_ABI_VERSION,
    page: "generic-v1",
    rows: "rows-v1",
    filter: "filter-v1",
    rowGroup: "layout-v1",
    maxRows: MAX_OPERATION_ROWS,
    defaultRows: DEFAULT_FILTER_ROWS,
    types: decodedTypes,
    encodings: ENCODINGS,
    compression: {
      metadata: COMPRESSION_METADATA,
      payload: "inactive",
      reason: "postscript-v1-unused",
    },
    nested: "portable-v1",
  };
}
