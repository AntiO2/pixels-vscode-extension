import {
  DEFAULT_SCAN_ROWS,
  MAX_EXPRESSION_DEPTH,
  MAX_EXPRESSION_NODES,
  MAX_LITERAL_POOL_BYTES,
  MAX_ORDER_KEYS,
  MAX_ORDERED_WINDOW_ROWS,
  MAX_PREDICATE_LEAVES,
  MAX_PROJECTION_COLUMNS,
  MAX_SCAN_CURSOR_BYTES,
  MAX_SCAN_LITERAL_BYTES,
  MAX_SCAN_PLAN_BYTES,
  MAX_SCAN_ROWS,
} from "./constants.js";
import { InspectorError } from "./errors.js";
import { parseUnsignedDecimal } from "./integers.js";
import type { FilterOperator } from "./messages.js";

const UINT32_MAX = 0xffff_ffff;
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const PLAN_HEADER_BYTES = 48;
const EXPRESSION_NODE_BYTES = 20;
const ORDER_KEY_BYTES = 8;
const PLAN_MAGIC = Object.freeze([0x50, 0x58, 0x53, 0x56]);
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const SCAN_CURSOR_TEXT_BYTES = 54;
const SCAN_CURSOR_MAGIC_BASE64URL = "UFhDMg";

const FILTER_OPERATOR_CODES: Readonly<Record<FilterOperator, number>> =
  Object.freeze({
    eq: 0,
    ne: 1,
    lt: 2,
    le: 3,
    gt: 4,
    ge: 5,
    isNull: 6,
    isNotNull: 7,
    contains: 8,
  });

export type ScanProjectionV2 =
  | { readonly kind: "all" }
  | {
      readonly kind: "columns";
      readonly columns: readonly number[];
    };

export type ScanExpressionV2 =
  | {
      readonly kind: "predicate";
      readonly column: number;
      readonly operator: FilterOperator;
      readonly literal: string;
    }
  | {
      readonly kind: "and" | "or";
      readonly children: readonly ScanExpressionV2[];
    }
  | {
      readonly kind: "not";
      readonly child: ScanExpressionV2;
    };

export interface ScanOrderKeyV2 {
  readonly column: number;
  readonly direction: "asc" | "desc";
  readonly nulls: "first" | "last";
}

export interface ScanPlanV2 {
  readonly projection: ScanProjectionV2;
  readonly predicate?: ScanExpressionV2;
  readonly orderBy: readonly ScanOrderKeyV2[];
  readonly offset: string;
  readonly limit: number;
  readonly cursor?: string;
}

export const DEFAULT_SCAN_PLAN_V2: ScanPlanV2 = Object.freeze({
  projection: Object.freeze({ kind: "all" as const }),
  orderBy: Object.freeze([]),
  offset: "0",
  limit: DEFAULT_SCAN_ROWS,
});

export type ScanPhaseV2 =
  | "validating"
  | "scanning"
  | "projecting"
  | "complete";

export interface ScanProgressV2 {
  readonly phase: ScanPhaseV2;
  readonly rowGroupsTotal: number;
  readonly rowGroupsConsidered: number;
  readonly scannedRowGroups: number;
  readonly prunedRowGroups: number;
  readonly currentRowGroup: number | null;
  readonly retainedCandidates: number;
  readonly rowsTotal: string;
  readonly scannedRows: string;
  readonly prunedRows: string;
  readonly matchedRows: string;
}

interface EncodedNode {
  readonly kind: 0 | 1 | 2 | 3 | 4;
  readonly operator: number;
  readonly childCount: number;
  readonly column: number;
  readonly literalOffset: number;
  readonly literalLength: number;
}

interface PlanEncoding {
  readonly plan: ScanPlanV2;
  readonly offset: bigint;
  readonly nodes: readonly EncodedNode[];
  readonly literals: Uint8Array;
  readonly cursor: Uint8Array;
}

function fail(message: string): never {
  throw new InspectorError("INVALID_MESSAGE", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uint32(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > UINT32_MAX
  ) {
    fail(`${field} must be an unsigned 32-bit integer`);
  }
  return value;
}

function boundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${field} must be ${String(minimum)}..${String(maximum)}`);
  }
  return value;
}

function decodeProjection(value: unknown): ScanProjectionV2 {
  if (!isRecord(value)) {
    fail("scan.projection must be an object");
  }
  if (value["kind"] === "all") {
    return { kind: "all" };
  }
  if (value["kind"] !== "columns" || !Array.isArray(value["columns"])) {
    fail("scan.projection must select all or an explicit column list");
  }
  const columns = value["columns"].map((column, index) =>
    uint32(column, `scan.projection.columns[${String(index)}]`),
  );
  if (
    columns.length === 0 ||
    columns.length > MAX_PROJECTION_COLUMNS ||
    new Set(columns).size !== columns.length
  ) {
    fail(
      `scan.projection.columns must contain 1..${String(MAX_PROJECTION_COLUMNS)} unique columns`,
    );
  }
  return { kind: "columns", columns };
}

function decodeExpression(
  value: unknown,
  path: string,
  depth: number,
  counts: { nodes: number; leaves: number; literalBytes: number },
): ScanExpressionV2 {
  if (!isRecord(value)) {
    fail(`${path} must be an object`);
  }
  if (depth > MAX_EXPRESSION_DEPTH) {
    fail(`scan predicate depth exceeds ${String(MAX_EXPRESSION_DEPTH)}`);
  }
  counts.nodes += 1;
  if (counts.nodes > MAX_EXPRESSION_NODES) {
    fail(`scan predicate exceeds ${String(MAX_EXPRESSION_NODES)} nodes`);
  }
  switch (value["kind"]) {
    case "predicate": {
      counts.leaves += 1;
      if (counts.leaves > MAX_PREDICATE_LEAVES) {
        fail(`scan predicate exceeds ${String(MAX_PREDICATE_LEAVES)} leaves`);
      }
      const operator = value["operator"];
      if (
        typeof operator !== "string" ||
        !Object.hasOwn(FILTER_OPERATOR_CODES, operator)
      ) {
        fail(`${path}.operator is unsupported`);
      }
      const literal = value["literal"];
      if (typeof literal !== "string") {
        fail(`${path}.literal must be a string`);
      }
      if (
        (operator === "isNull" || operator === "isNotNull") &&
        literal.length !== 0
      ) {
        fail(`${path}.${operator} requires an empty literal`);
      }
      const literalBytes = new TextEncoder().encode(literal).byteLength;
      if (literalBytes > MAX_SCAN_LITERAL_BYTES) {
        fail(
          `${path}.literal exceeds ${String(MAX_SCAN_LITERAL_BYTES)} UTF-8 bytes`,
        );
      }
      counts.literalBytes += literalBytes;
      if (counts.literalBytes > MAX_LITERAL_POOL_BYTES) {
        fail(
          `scan literal pool exceeds ${String(MAX_LITERAL_POOL_BYTES)} UTF-8 bytes`,
        );
      }
      return {
        kind: "predicate",
        column: uint32(value["column"], `${path}.column`),
        operator: operator as FilterOperator,
        literal,
      };
    }
    case "and":
    case "or": {
      if (
        !Array.isArray(value["children"]) ||
        value["children"].length < 2 ||
        value["children"].length > 8
      ) {
        fail(`${path}.children must contain 2..8 expressions`);
      }
      return {
        kind: value["kind"],
        children: value["children"].map((child, index) =>
          decodeExpression(
            child,
            `${path}.children[${String(index)}]`,
            depth + 1,
            counts,
          ),
        ),
      };
    }
    case "not":
      return {
        kind: "not",
        child: decodeExpression(
          value["child"],
          `${path}.child`,
          depth + 1,
          counts,
        ),
      };
    default:
      return fail(`${path}.kind is unsupported`);
  }
}

export function decodeScanPlanV2(value: unknown): ScanPlanV2 {
  if (!isRecord(value)) {
    fail("scan plan must be an object");
  }
  const projection = decodeProjection(value["projection"]);
  const predicateValue = value["predicate"];
  const predicate =
    predicateValue === undefined
      ? undefined
      : decodeExpression(
          predicateValue,
          "scan.predicate",
          1,
          { nodes: 0, leaves: 0, literalBytes: 0 },
        );
  if (!Array.isArray(value["orderBy"])) {
    fail("scan.orderBy must be an array");
  }
  if (value["orderBy"].length > MAX_ORDER_KEYS) {
    fail(`scan.orderBy exceeds ${String(MAX_ORDER_KEYS)} keys`);
  }
  const orderBy = value["orderBy"].map((item, index): ScanOrderKeyV2 => {
    const path = `scan.orderBy[${String(index)}]`;
    if (!isRecord(item)) {
      fail(`${path} must be an object`);
    }
    if (item["direction"] !== "asc" && item["direction"] !== "desc") {
      fail(`${path}.direction must be asc or desc`);
    }
    if (item["nulls"] !== "first" && item["nulls"] !== "last") {
      fail(`${path}.nulls must be first or last`);
    }
    return {
      column: uint32(item["column"], `${path}.column`),
      direction: item["direction"],
      nulls: item["nulls"],
    };
  });
  if (new Set(orderBy.map((key) => key.column)).size !== orderBy.length) {
    fail("scan.orderBy columns must be unique");
  }

  if (typeof value["offset"] !== "string") {
    fail("scan.offset must be a canonical unsigned decimal string");
  }
  const offset = parseUnsignedDecimal(value["offset"], "scan.offset");
  if (offset > UINT64_MAX) {
    fail("scan.offset must fit an unsigned 64-bit integer");
  }
  const limit = boundedInteger(value["limit"], "scan.limit", 1, MAX_SCAN_ROWS);
  const cursorValue = value["cursor"];
  let cursor: string | undefined;
  if (cursorValue !== undefined) {
    if (
      typeof cursorValue !== "string" ||
      cursorValue.length === 0 ||
      !isCanonicalScanCursorV2(cursorValue) ||
      new TextEncoder().encode(cursorValue).byteLength > MAX_SCAN_CURSOR_BYTES
    ) {
      fail("scan.cursor must be a bounded base64url string");
    }
    if (offset !== 0n) {
      fail("scan.cursor requires offset 0");
    }
    cursor = cursorValue;
  }
  if (
    orderBy.length > 0 &&
    cursor === undefined &&
    offset + BigInt(limit) > BigInt(MAX_ORDERED_WINDOW_ROWS)
  ) {
    fail(
      `initial ordered scan window exceeds ${String(MAX_ORDERED_WINDOW_ROWS)} rows`,
    );
  }
  return {
    projection,
    ...(predicate === undefined ? {} : { predicate }),
    orderBy,
    offset: offset.toString(),
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export function isCanonicalScanCursorV2(value: string): boolean {
  return (
    value.length === SCAN_CURSOR_TEXT_BYTES &&
    value.startsWith(SCAN_CURSOR_MAGIC_BASE64URL) &&
    BASE64URL.test(value)
  );
}

function encodeExpression(
  expression: ScanExpressionV2 | undefined,
): { readonly nodes: readonly EncodedNode[]; readonly literals: Uint8Array } {
  const nodes: EncodedNode[] = [];
  const literalParts: Uint8Array[] = [];
  let literalBytes = 0;
  const append = (node: ScanExpressionV2): void => {
    switch (node.kind) {
      case "predicate": {
        const literal = new TextEncoder().encode(node.literal);
        nodes.push({
          kind: 1,
          operator: FILTER_OPERATOR_CODES[node.operator],
          childCount: 0,
          column: node.column,
          literalOffset: literalBytes,
          literalLength: literal.byteLength,
        });
        literalParts.push(literal);
        literalBytes += literal.byteLength;
        return;
      }
      case "and":
      case "or":
        node.children.forEach(append);
        nodes.push({
          kind: node.kind === "and" ? 2 : 3,
          operator: 0,
          childCount: node.children.length,
          column: 0,
          literalOffset: 0,
          literalLength: 0,
        });
        return;
      case "not":
        append(node.child);
        nodes.push({
          kind: 4,
          operator: 0,
          childCount: 1,
          column: 0,
          literalOffset: 0,
          literalLength: 0,
        });
        return;
    }
  };
  if (expression === undefined) {
    nodes.push({
      kind: 0,
      operator: 0,
      childCount: 0,
      column: 0,
      literalOffset: 0,
      literalLength: 0,
    });
  } else {
    append(expression);
  }
  if (literalBytes > MAX_LITERAL_POOL_BYTES) {
    fail(
      `scan literal pool exceeds ${String(MAX_LITERAL_POOL_BYTES)} UTF-8 bytes`,
    );
  }
  const literals = new Uint8Array(literalBytes);
  let position = 0;
  for (const part of literalParts) {
    literals.set(part, position);
    position += part.byteLength;
  }
  return { nodes, literals };
}

function prepareEncoding(value: unknown): PlanEncoding {
  const plan = decodeScanPlanV2(value);
  const encoded = encodeExpression(plan.predicate);
  return {
    plan,
    offset: BigInt(plan.offset),
    nodes: encoded.nodes,
    literals: encoded.literals,
    cursor: new TextEncoder().encode(plan.cursor ?? ""),
  };
}

export function encodeScanPlanV2(value: unknown): Uint8Array {
  const encoding = prepareEncoding(value);
  const projection =
    encoding.plan.projection.kind === "columns"
      ? encoding.plan.projection.columns
      : [];
  const totalBytes =
    PLAN_HEADER_BYTES +
    projection.length * 4 +
    encoding.nodes.length * EXPRESSION_NODE_BYTES +
    encoding.plan.orderBy.length * ORDER_KEY_BYTES +
    encoding.literals.byteLength +
    encoding.cursor.byteLength;
  if (totalBytes > MAX_SCAN_PLAN_BYTES) {
    fail(`scan plan packet exceeds ${String(MAX_SCAN_PLAN_BYTES)} bytes`);
  }
  const bytes = new Uint8Array(totalBytes);
  bytes.set(PLAN_MAGIC, 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 1, true);
  view.setUint16(6, PLAN_HEADER_BYTES, true);
  view.setUint32(8, totalBytes, true);
  view.setUint32(
    12,
    encoding.plan.projection.kind === "all" ? 1 : 0,
    true,
  );
  view.setUint16(16, projection.length, true);
  view.setUint16(18, encoding.nodes.length, true);
  view.setUint16(20, encoding.plan.orderBy.length, true);
  view.setUint32(24, encoding.literals.byteLength, true);
  view.setUint16(28, encoding.cursor.byteLength, true);
  view.setBigUint64(32, encoding.offset, true);
  view.setUint32(40, encoding.plan.limit, true);

  let position = PLAN_HEADER_BYTES;
  for (const column of projection) {
    view.setUint32(position, column, true);
    position += 4;
  }
  for (const node of encoding.nodes) {
    view.setUint8(position, node.kind);
    view.setUint8(position + 1, node.operator);
    view.setUint16(position + 2, node.childCount, true);
    view.setUint32(position + 4, node.column, true);
    view.setUint32(position + 8, node.literalOffset, true);
    view.setUint32(position + 12, node.literalLength, true);
    position += EXPRESSION_NODE_BYTES;
  }
  for (const key of encoding.plan.orderBy) {
    view.setUint32(position, key.column, true);
    view.setUint8(position + 4, key.direction === "asc" ? 0 : 1);
    view.setUint8(position + 5, key.nulls === "first" ? 0 : 1);
    position += ORDER_KEY_BYTES;
  }
  bytes.set(encoding.literals, position);
  position += encoding.literals.byteLength;
  bytes.set(encoding.cursor, position);
  return bytes;
}

export function decodeScanProgressV2(
  value: unknown,
  path = "scan progress",
): ScanProgressV2 {
  if (!isRecord(value)) {
    fail(`${path} must be an object`);
  }
  const phase = value["phase"];
  if (
    phase !== "validating" &&
    phase !== "scanning" &&
    phase !== "projecting" &&
    phase !== "complete"
  ) {
    fail(`${path}.phase is invalid`);
  }
  const current = value["currentRowGroup"];
  const currentRowGroup =
    current === null ? null : uint32(current, `${path}.currentRowGroup`);
  const rowsTotal = canonicalUint64(value["rowsTotal"], `${path}.rowsTotal`);
  const scannedRows = canonicalUint64(
    value["scannedRows"],
    `${path}.scannedRows`,
  );
  const prunedRows = canonicalUint64(
    value["prunedRows"],
    `${path}.prunedRows`,
  );
  const matchedRows = canonicalUint64(
    value["matchedRows"],
    `${path}.matchedRows`,
  );
  const result: ScanProgressV2 = {
    phase,
    rowGroupsTotal: uint32(value["rowGroupsTotal"], `${path}.rowGroupsTotal`),
    rowGroupsConsidered: uint32(
      value["rowGroupsConsidered"],
      `${path}.rowGroupsConsidered`,
    ),
    scannedRowGroups: uint32(
      value["scannedRowGroups"],
      `${path}.scannedRowGroups`,
    ),
    prunedRowGroups: uint32(
      value["prunedRowGroups"],
      `${path}.prunedRowGroups`,
    ),
    currentRowGroup,
    retainedCandidates: uint32(
      value["retainedCandidates"],
      `${path}.retainedCandidates`,
    ),
    rowsTotal,
    scannedRows,
    prunedRows,
    matchedRows,
  };
  if (
    result.rowGroupsConsidered > result.rowGroupsTotal ||
    result.scannedRowGroups + result.prunedRowGroups >
      result.rowGroupsConsidered ||
    BigInt(result.scannedRows) + BigInt(result.prunedRows) >
      BigInt(result.rowsTotal) ||
    BigInt(result.matchedRows) > BigInt(result.scannedRows) ||
    result.retainedCandidates > MAX_ORDERED_WINDOW_ROWS ||
    (result.currentRowGroup !== null &&
      result.currentRowGroup >= result.rowGroupsTotal)
  ) {
    fail(`${path} counters are inconsistent`);
  }
  return result;
}

function canonicalUint64(value: unknown, field: string): string {
  if (typeof value !== "string") {
    fail(`${field} must be a canonical unsigned decimal string`);
  }
  const parsed = parseUnsignedDecimal(value, field);
  if (parsed > UINT64_MAX) {
    fail(`${field} must fit an unsigned 64-bit integer`);
  }
  return parsed.toString();
}
