import {
  MAX_EXPRESSION_DEPTH,
  MAX_ORDER_KEYS,
  MAX_PREDICATE_LEAVES,
  MAX_PROJECTION_COLUMNS,
  MAX_SCAN_ROWS,
  decodeScanPlanV2,
} from "@pixels-inspector/protocol-client";
import type {
  FilterOperator,
  MetadataResult,
  ScanExpressionV2,
  ScanPlanV2,
  ScanResultV2,
  SchemaType,
} from "@pixels-inspector/protocol-client";

const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const SCALAR_KINDS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 9, 14, 15, 16, 17, 18]);
const STRING_KINDS = new Set([7, 16, 17]);

export const OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
  eq: "=",
  ne: "!=",
  lt: "<",
  le: "≤",
  gt: ">",
  ge: "≥",
  isNull: "is null",
  isNotNull: "is not null",
  contains: "contains",
};

export interface QueryValidation {
  readonly fields: Readonly<Record<string, string>>;
  readonly valid: boolean;
}

export function projectionForColumns(
  rootColumns: readonly number[],
  selectedColumns: readonly number[],
): ScanPlanV2["projection"] {
  if (
    selectedColumns.length === rootColumns.length &&
    rootColumns.every((column, index) => selectedColumns[index] === column)
  ) {
    return { kind: "all" };
  }
  return { kind: "columns", columns: selectedColumns };
}

export function continuationStatus(
  page: Pick<
    ScanResultV2["page"],
    "continuationAvailable" | "hasMoreExact"
  >,
): string {
  if (page.hasMoreExact) {
    return page.continuationAvailable
      ? "More rows are available"
      : "No further rows";
  }
  return page.continuationAvailable
    ? "Another matching row is not yet known"
    : "Further availability was not proven";
}

export function schemaTypeById(
  metadata: MetadataResult,
  column: number,
): SchemaType | undefined {
  return metadata.schema.find((type) => type.id === column);
}

export function isComparableType(type: SchemaType): boolean {
  return SCALAR_KINDS.has(type.kind);
}

export function operatorsForType(
  type: SchemaType | undefined,
): readonly FilterOperator[] {
  if (type === undefined || !SCALAR_KINDS.has(type.kind)) {
    return [];
  }
  if (type.kind === 0) {
    return ["eq", "ne", "isNull", "isNotNull"];
  }
  if (STRING_KINDS.has(type.kind)) {
    return [
      "eq",
      "ne",
      "lt",
      "le",
      "gt",
      "ge",
      "contains",
      "isNull",
      "isNotNull",
    ];
  }
  return ["eq", "ne", "lt", "le", "gt", "ge", "isNull", "isNotNull"];
}

export function expressionSummary(expression: ScanExpressionV2 | undefined): string {
  if (expression === undefined) {
    return "All rows";
  }
  switch (expression.kind) {
    case "predicate":
      return `${OPERATOR_LABELS[expression.operator]} condition`;
    case "not":
      return `NOT ${expressionSummary(expression.child)}`;
    case "and":
    case "or":
      return `${expression.kind.toUpperCase()} · ${String(expression.children.length)} conditions`;
  }
}

function validateExpression(
  expression: ScanExpressionV2,
  metadata: MetadataResult,
  rootColumns: ReadonlySet<number>,
  path: string,
  depth: number,
  counts: { leaves: number },
  fields: Record<string, string>,
): void {
  if (depth > MAX_EXPRESSION_DEPTH) {
    fields[path] = `Nesting is limited to ${String(MAX_EXPRESSION_DEPTH)} levels.`;
    return;
  }
  switch (expression.kind) {
    case "and":
    case "or":
      if (expression.children.length < 2 || expression.children.length > 8) {
        fields[path] = "Groups need 2 to 8 conditions.";
      }
      expression.children.forEach((child, index) => {
        validateExpression(
          child,
          metadata,
          rootColumns,
          `${path}.${String(index)}`,
          depth + 1,
          counts,
          fields,
        );
      });
      return;
    case "not":
      validateExpression(
        expression.child,
        metadata,
        rootColumns,
        `${path}.not`,
        depth + 1,
        counts,
        fields,
      );
      return;
    case "predicate": {
      counts.leaves += 1;
      if (counts.leaves > MAX_PREDICATE_LEAVES) {
        fields[path] = `Where is limited to ${String(MAX_PREDICATE_LEAVES)} conditions.`;
      }
      const type = schemaTypeById(metadata, expression.column);
      const operators = operatorsForType(type);
      if (
        type === undefined ||
        !rootColumns.has(expression.column) ||
        !operators.includes(expression.operator)
      ) {
        fields[path] = "Choose a compatible root scalar column and operator.";
      } else if (
        expression.operator !== "isNull" &&
        expression.operator !== "isNotNull" &&
        expression.literal.length === 0 &&
        !STRING_KINDS.has(type.kind)
      ) {
        fields[`${path}.literal`] = "Enter a typed value.";
      }
    }
  }
}

export function validateQueryPlan(
  plan: ScanPlanV2,
  metadata: MetadataResult,
): QueryValidation {
  const fields: Record<string, string> = {};
  const rootColumns = new Set(
    metadata.schema
      .filter(
        (type) =>
          !metadata.schema.some((candidate) => candidate.subtypes.includes(type.id)),
      )
      .map((type) => type.id),
  );
  if (
    plan.projection.kind === "all" &&
    rootColumns.size > MAX_PROJECTION_COLUMNS
  ) {
    fields["projection"] = `Choose at most ${String(MAX_PROJECTION_COLUMNS)} output columns.`;
  } else if (
    plan.projection.kind === "columns" &&
    (plan.projection.columns.length === 0 ||
      plan.projection.columns.some((column) => !rootColumns.has(column)))
  ) {
    fields["projection"] = "Choose at least one root output column.";
  }
  if (plan.predicate !== undefined) {
    validateExpression(
      plan.predicate,
      metadata,
      rootColumns,
      "predicate",
      1,
      { leaves: 0 },
      fields,
    );
  }
  if (plan.orderBy.length > MAX_ORDER_KEYS) {
    fields["order"] = `Order is limited to ${String(MAX_ORDER_KEYS)} keys.`;
  }
  const seenOrderColumns = new Set<number>();
  plan.orderBy.forEach((key, index) => {
    const type = schemaTypeById(metadata, key.column);
    if (
      seenOrderColumns.has(key.column) ||
      type === undefined ||
      !rootColumns.has(key.column) ||
      !isComparableType(type)
    ) {
      fields[`order.${String(index)}`] =
        "Order keys must be unique comparable root scalar columns.";
    }
    seenOrderColumns.add(key.column);
  });
  if (!/^(?:0|[1-9]\d*)$/u.test(plan.offset)) {
    fields["offset"] = "Offset must be a canonical unsigned integer.";
  } else if (BigInt(plan.offset) > UINT64_MAX) {
    fields["offset"] = "Offset exceeds the unsigned 64-bit range.";
  }
  if (
    !Number.isSafeInteger(plan.limit) ||
    plan.limit < 1 ||
    plan.limit > MAX_SCAN_ROWS
  ) {
    fields["limit"] = `Limit must be 1 to ${String(MAX_SCAN_ROWS)}.`;
  }
  if (Object.keys(fields).length === 0) {
    try {
      decodeScanPlanV2(plan);
    } catch (error) {
      fields["plan"] =
        error instanceof Error ? error.message : "The scan plan is invalid.";
    }
  }
  return { fields, valid: Object.keys(fields).length === 0 };
}
