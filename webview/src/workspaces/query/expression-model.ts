import type {
  ScanExpressionV2,
  SchemaType,
} from "@pixels-inspector/protocol-client";

import {
  operatorsForType,
} from "./query-plan.js";

export type ExpressionPath = readonly (number | "not")[];
export type PredicateExpression = Extract<
  ScanExpressionV2,
  { readonly kind: "predicate" }
>;

export function isPredicateExpression(
  expression: ScanExpressionV2,
): expression is PredicateExpression {
  return expression.kind === "predicate";
}

export function expressionAt(
  expression: ScanExpressionV2,
  path: ExpressionPath,
): ScanExpressionV2 | undefined {
  let current: ScanExpressionV2 | undefined = expression;
  for (const segment of path) {
    if (segment === "not") {
      current = current.kind === "not" ? current.child : undefined;
    } else {
      current =
        current.kind === "and" || current.kind === "or"
          ? current.children[segment]
          : undefined;
    }
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
}

export function replaceExpression(
  expression: ScanExpressionV2,
  path: ExpressionPath,
  replacement: ScanExpressionV2 | undefined,
): ScanExpressionV2 | undefined {
  const [head, ...tail] = path;
  if (head === undefined) {
    return replacement;
  }
  if (head === "not") {
    if (expression.kind !== "not") {
      return expression;
    }
    const child = replaceExpression(expression.child, tail, replacement);
    return child === undefined ? undefined : { kind: "not", child };
  }
  if (expression.kind !== "and" && expression.kind !== "or") {
    return expression;
  }
  const children = expression.children
    .map((child, index) =>
      index === head ? replaceExpression(child, tail, replacement) : child,
    )
    .filter((child): child is ScanExpressionV2 => child !== undefined);
  if (children.length === 0) {
    return undefined;
  }
  if (children.length === 1) {
    return children[0];
  }
  return { ...expression, children };
}

export function updateExpression(
  expression: ScanExpressionV2,
  path: ExpressionPath,
  update: (current: ScanExpressionV2) => ScanExpressionV2,
): ScanExpressionV2 {
  const current = expressionAt(expression, path);
  return current === undefined
    ? expression
    : replaceExpression(expression, path, update(current)) ?? expression;
}

export function moveExpressionChild(
  expression: ScanExpressionV2,
  groupPath: ExpressionPath,
  index: number,
  direction: -1 | 1,
): ScanExpressionV2 {
  return updateExpression(expression, groupPath, (current) => {
    if (current.kind !== "and" && current.kind !== "or") {
      return current;
    }
    const target = index + direction;
    if (target < 0 || target >= current.children.length) {
      return current;
    }
    const children = [...current.children];
    const adjacent = children[target];
    const selected = children[index];
    if (adjacent === undefined || selected === undefined) {
      return current;
    }
    children[target] = selected;
    children[index] = adjacent;
    return { ...current, children };
  });
}

export function newPredicate(
  rootTypes: readonly SchemaType[],
): ScanExpressionV2 | undefined {
  const type = rootTypes.find(
    (candidate) => operatorsForType(candidate).length > 0,
  );
  if (type === undefined) {
    return undefined;
  }
  return {
    kind: "predicate",
    column: type.id,
    operator: operatorsForType(type)[0] ?? "eq",
    literal: "",
  };
}
