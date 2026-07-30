import {
  MAX_FILTER_CURSOR_BYTES,
  MAX_FILTER_LITERAL_BYTES,
  MAX_OPERATION_ROWS,
  MAX_PROJECTION_COLUMNS,
  PROTOCOL_VERSION,
} from "./constants.js";
import type { CoreCapabilities } from "./capabilities.js";
import { decodeCoreCapabilities } from "./capabilities.js";
import { InspectorError } from "./errors.js";
import type { CoreManifest } from "./manifest.js";
import { decodeCoreManifest } from "./manifest.js";
import { parseUnsignedDecimal } from "./integers.js";

export interface ProtocolVersion {
  readonly major: number;
  readonly minor: number;
}

interface MessageBase {
  readonly kind: string;
}

export interface InitializeMessage extends MessageBase {
  readonly kind: "initialize";
  readonly version: ProtocolVersion;
  readonly generation: number;
  readonly manifest: CoreManifest;
  readonly loaderUrl: string;
  readonly wasmUrl: string;
}

export interface InspectMetadataMessage extends MessageBase {
  readonly kind: "inspectMetadata";
  readonly requestId: string;
  readonly sourceSize: string;
}

export interface InspectPageMessage extends MessageBase {
  readonly kind: "inspectPage";
  readonly requestId: string;
  readonly rowGroup: number;
  readonly column: number;
  readonly rowOffset: string;
  readonly rowCount: number;
}

export interface InspectRowsMessage extends MessageBase {
  readonly kind: "inspectRows";
  readonly requestId: string;
  readonly rowGroup: number;
  readonly columns: readonly number[];
  readonly rowOffset: string;
  readonly rowCount: number;
}

export type FilterOperator =
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "isNull"
  | "isNotNull"
  | "contains";

export interface InspectFilterMessage extends MessageBase {
  readonly kind: "inspectFilter";
  readonly requestId: string;
  readonly predicate: {
    readonly column: number;
    readonly operator: FilterOperator;
    readonly literal: string;
  };
  readonly columns: readonly number[];
  readonly cursor?: string;
  readonly limit: number;
}

export interface InspectRowGroupMessage extends MessageBase {
  readonly kind: "inspectRowGroup";
  readonly requestId: string;
  readonly rowGroup: number;
}

export interface SupplyRangeMessage extends MessageBase {
  readonly kind: "supplyRange";
  readonly requestId: string;
  readonly offset: string;
  readonly bytes: ArrayBuffer;
}

export interface CancelMessage extends MessageBase {
  readonly kind: "cancel";
  readonly requestId: string;
}

export interface DisposeMessage extends MessageBase {
  readonly kind: "dispose";
}

export type ControllerMessage =
  | InitializeMessage
  | InspectMetadataMessage
  | InspectRowGroupMessage
  | InspectPageMessage
  | InspectRowsMessage
  | InspectFilterMessage
  | SupplyRangeMessage
  | CancelMessage
  | DisposeMessage;

export interface ReadyMessage extends MessageBase {
  readonly kind: "ready";
  readonly version: ProtocolVersion;
  readonly generation: number;
  readonly abi: number;
  readonly coreDigest: string;
  readonly capabilities: CoreCapabilities;
}

export interface RangeNeededMessage extends MessageBase {
  readonly kind: "rangeNeeded";
  readonly requestId: string;
  readonly offset: string;
  readonly length: string;
}

export interface ResultMessage extends MessageBase {
  readonly kind: "result";
  readonly requestId: string;
  readonly operation: "metadata" | "rowGroup" | "page" | "rows" | "filter";
  readonly json: string;
}

export interface ErrorMessage extends MessageBase {
  readonly kind: "error";
  readonly requestId?: string;
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export type WorkerMessage =
  | ReadyMessage
  | RangeNeededMessage
  | ResultMessage
  | ErrorMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  value: Record<string, unknown>,
  field: string,
): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      `${field} must be a non-empty string`,
    );
  }
  return candidate;
}

function integerField(
  value: Record<string, unknown>,
  field: string,
): number {
  const candidate = value[field];
  if (
    typeof candidate !== "number" ||
    !Number.isSafeInteger(candidate) ||
    candidate < 0
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      `${field} must be a non-negative safe integer`,
    );
  }
  return candidate;
}

function uint32Field(
  value: Record<string, unknown>,
  field: string,
): number {
  const candidate = integerField(value, field);
  if (candidate > 0xffff_ffff) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      `${field} must fit an unsigned 32-bit integer`,
    );
  }
  return candidate;
}

function stringValue(
  value: Record<string, unknown>,
  field: string,
): string {
  const candidate = value[field];
  if (typeof candidate !== "string") {
    throw new InspectorError(
      "INVALID_MESSAGE",
      `${field} must be a string`,
    );
  }
  return candidate;
}

function columnsField(
  value: Record<string, unknown>,
  field: string,
): readonly number[] {
  const candidate = value[field];
  if (
    !Array.isArray(candidate) ||
    candidate.length === 0 ||
    candidate.length > MAX_PROJECTION_COLUMNS
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      `${field} must contain 1..${String(MAX_PROJECTION_COLUMNS)} columns`,
    );
  }
  const columns = candidate.map((column, index) => {
    if (
      typeof column !== "number" ||
      !Number.isSafeInteger(column) ||
      column < 0 ||
      column > 0xffff_ffff
    ) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        `${field}[${String(index)}] must be an unsigned 32-bit integer`,
      );
    }
    return column;
  });
  if (new Set(columns).size !== columns.length) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      `${field} must contain unique columns`,
    );
  }
  return columns;
}

const FILTER_OPERATORS = new Set<FilterOperator>([
  "eq",
  "ne",
  "lt",
  "le",
  "gt",
  "ge",
  "isNull",
  "isNotNull",
  "contains",
]);

function filterOperatorField(
  value: Record<string, unknown>,
  field: string,
): FilterOperator {
  const candidate = value[field];
  if (
    typeof candidate !== "string" ||
    !FILTER_OPERATORS.has(candidate as FilterOperator)
  ) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      `${field} is not a supported filter operator`,
    );
  }
  return candidate as FilterOperator;
}

function boundedRowCount(
  value: Record<string, unknown>,
  field: string,
  allowDefault = false,
): number {
  const count = integerField(value, field);
  if ((!allowDefault && count === 0) || count > MAX_OPERATION_ROWS) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      `${field} must be ${allowDefault ? "0.." : "1.."}${String(MAX_OPERATION_ROWS)}`,
    );
  }
  return count;
}

function versionField(value: unknown): ProtocolVersion {
  if (!isRecord(value)) {
    throw new InspectorError("INVALID_MESSAGE", "version must be an object");
  }
  return {
    major: integerField(value, "major"),
    minor: integerField(value, "minor"),
  };
}

function assertProtocol(version: ProtocolVersion): void {
  if (version.major !== PROTOCOL_VERSION.major) {
    throw new InspectorError(
      "PROTOCOL_MISMATCH",
      `worker protocol major ${String(version.major)} is unsupported`,
    );
  }
}

export function decodeControllerMessage(value: unknown): ControllerMessage {
  if (!isRecord(value)) {
    throw new InspectorError("INVALID_MESSAGE", "worker input must be an object");
  }
  const kind = stringField(value, "kind");
  switch (kind) {
    case "initialize": {
      const version = versionField(value["version"]);
      assertProtocol(version);
      return {
        kind,
        version,
        generation: integerField(value, "generation"),
        manifest: decodeCoreManifest(value["manifest"]),
        loaderUrl: stringField(value, "loaderUrl"),
        wasmUrl: stringField(value, "wasmUrl"),
      };
    }
    case "inspectMetadata": {
      const sourceSize = stringField(value, "sourceSize");
      parseUnsignedDecimal(sourceSize, "sourceSize");
      return {
        kind,
        requestId: stringField(value, "requestId"),
        sourceSize,
      };
    }
    case "inspectPage": {
      const rowOffset = stringField(value, "rowOffset");
      parseUnsignedDecimal(rowOffset, "rowOffset");
      return {
        kind,
        requestId: stringField(value, "requestId"),
        rowGroup: uint32Field(value, "rowGroup"),
        column: uint32Field(value, "column"),
        rowOffset,
        rowCount: boundedRowCount(value, "rowCount"),
      };
    }
    case "inspectRows": {
      const rowOffset = stringField(value, "rowOffset");
      parseUnsignedDecimal(rowOffset, "rowOffset");
      return {
        kind,
        requestId: stringField(value, "requestId"),
        rowGroup: uint32Field(value, "rowGroup"),
        columns: columnsField(value, "columns"),
        rowOffset,
        rowCount: boundedRowCount(value, "rowCount"),
      };
    }
    case "inspectFilter": {
      const predicateValue = value["predicate"];
      if (!isRecord(predicateValue)) {
        throw new InspectorError(
          "INVALID_MESSAGE",
          "predicate must be an object",
        );
      }
      const operator = filterOperatorField(predicateValue, "operator");
      const literal = stringValue(predicateValue, "literal");
      if (
        new TextEncoder().encode(literal).byteLength >
        MAX_FILTER_LITERAL_BYTES
      ) {
        throw new InspectorError(
          "INVALID_MESSAGE",
          `predicate literal exceeds ${String(MAX_FILTER_LITERAL_BYTES)} UTF-8 bytes`,
        );
      }
      if (
        (operator === "isNull" || operator === "isNotNull") &&
        literal.length !== 0
      ) {
        throw new InspectorError(
          "INVALID_MESSAGE",
          `${operator} requires an empty literal`,
        );
      }
      const cursor = value["cursor"];
      if (
        cursor !== undefined &&
        (typeof cursor !== "string" ||
          cursor.length === 0 ||
          new TextEncoder().encode(cursor).byteLength >
            MAX_FILTER_CURSOR_BYTES)
      ) {
        throw new InspectorError(
          "INVALID_MESSAGE",
          "cursor must be a non-empty string when present",
        );
      }
      return {
        kind,
        requestId: stringField(value, "requestId"),
        predicate: {
          column: uint32Field(predicateValue, "column"),
          operator,
          literal,
        },
        columns: columnsField(value, "columns"),
        ...(cursor === undefined ? {} : { cursor }),
        limit: boundedRowCount(value, "limit", true),
      };
    }
    case "inspectRowGroup":
      return {
        kind,
        requestId: stringField(value, "requestId"),
        rowGroup: uint32Field(value, "rowGroup"),
      };
    case "supplyRange": {
      const offset = stringField(value, "offset");
      parseUnsignedDecimal(offset, "offset");
      if (!(value["bytes"] instanceof ArrayBuffer)) {
        throw new InspectorError(
          "INVALID_MESSAGE",
          "supplyRange.bytes must be an ArrayBuffer",
        );
      }
      return {
        kind,
        requestId: stringField(value, "requestId"),
        offset,
        bytes: value["bytes"],
      };
    }
    case "cancel":
      return {
        kind,
        requestId: stringField(value, "requestId"),
      };
    case "dispose":
      return { kind };
    default:
      throw new InspectorError(
        "INVALID_MESSAGE",
        `unknown controller message: ${kind}`,
      );
  }
}

export function decodeWorkerMessage(value: unknown): WorkerMessage {
  if (!isRecord(value)) {
    throw new InspectorError("INVALID_MESSAGE", "worker output must be an object");
  }
  const kind = stringField(value, "kind");
  switch (kind) {
    case "ready": {
      const version = versionField(value["version"]);
      assertProtocol(version);
      return {
        kind,
        version,
        generation: integerField(value, "generation"),
        abi: integerField(value, "abi"),
        coreDigest: stringField(value, "coreDigest"),
        capabilities: decodeCoreCapabilities(value["capabilities"]),
      };
    }
    case "rangeNeeded": {
      const offset = stringField(value, "offset");
      const length = stringField(value, "length");
      parseUnsignedDecimal(offset, "offset");
      parseUnsignedDecimal(length, "length");
      return {
        kind,
        requestId: stringField(value, "requestId"),
        offset,
        length,
      };
    }
    case "result": {
      const operation = stringField(value, "operation");
      if (
        operation !== "metadata" &&
        operation !== "rowGroup" &&
        operation !== "page" &&
        operation !== "rows" &&
        operation !== "filter"
      ) {
        throw new InspectorError(
          "INVALID_MESSAGE",
          "result operation is invalid",
        );
      }
      return {
        kind,
        requestId: stringField(value, "requestId"),
        operation,
        json: stringField(value, "json"),
      };
    }
    case "error": {
      const requestId = value["requestId"];
      if (requestId !== undefined && typeof requestId !== "string") {
        throw new InspectorError(
          "INVALID_MESSAGE",
          "error requestId must be a string",
        );
      }
      if (typeof value["recoverable"] !== "boolean") {
        throw new InspectorError(
          "INVALID_MESSAGE",
          "error recoverable must be boolean",
        );
      }
      return {
        kind,
        ...(requestId === undefined ? {} : { requestId }),
        code: stringField(value, "code"),
        message: stringField(value, "message"),
        recoverable: value["recoverable"],
      };
    }
    default:
      throw new InspectorError(
        "INVALID_MESSAGE",
        `unknown worker message: ${kind}`,
      );
  }
}
