import type {
  FilterOperator,
  MetadataResult,
  ScanExpressionV2,
  SchemaType,
} from "@pixels-inspector/protocol-client";
import type {
  ReactNode,
} from "react";

import type {
  AppState,
} from "../../app/model.js";
import {
  Icon,
} from "../../components/Icon.js";
import {
  TruncatedText,
} from "../../components/TruncatedText.js";
import {
  typeLabel,
} from "../shared/WorkspaceChrome.js";
import {
  type ExpressionPath,
  isPredicateExpression,
  moveExpressionChild,
  newPredicate,
  replaceExpression,
  updateExpression,
} from "./expression-model.js";
import {
  OPERATOR_LABELS,
  operatorsForType,
  schemaTypeById,
} from "./query-plan.js";

interface PredicateEditorProps {
  readonly expression: ScanExpressionV2;
  readonly rootTypes: readonly SchemaType[];
  readonly metadata: MetadataResult;
  readonly state: AppState;
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (expression: ScanExpressionV2 | undefined) => void;
}

interface PredicateNodeProps extends PredicateEditorProps {
  readonly node: ScanExpressionV2;
  readonly path: ExpressionPath;
  readonly depth: number;
  readonly index?: number;
  readonly parentPath?: ExpressionPath;
  readonly siblingCount?: number;
}

function PredicateValue({
  type,
  operator,
  value,
  error,
  onChange,
}: {
  readonly type: SchemaType | undefined;
  readonly operator: FilterOperator;
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
}): ReactNode {
  if (operator === "isNull" || operator === "isNotNull") {
    return <span className="predicate-no-value">No value required</span>;
  }
  if (type?.kind === 0) {
    return (
      <select
        aria-label="Boolean value"
        aria-invalid={error === undefined ? undefined : true}
        value={value}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      >
        <option value="">Choose value</option>
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    );
  }
  return (
    <input
      aria-label="Typed value"
      aria-invalid={error === undefined ? undefined : true}
      value={value}
      inputMode={
        type !== undefined && [1, 2, 3, 4, 5, 6, 14, 15, 18].includes(type.kind)
          ? "decimal"
          : "text"
      }
      placeholder={
        type?.kind === 14
          ? `decimal(${String(type.precision ?? 0)},${String(type.scale ?? 0)})`
          : "Value"
      }
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
    />
  );
}

function PredicateGroup(props: PredicateNodeProps): ReactNode {
  const {
    node,
    path,
    depth,
    expression,
    rootTypes,
    errors,
    onChange,
  } = props;
  if (node.kind !== "and" && node.kind !== "or") {
    return null;
  }
  const pathKey = `predicate${path
    .map((segment) => `.${String(segment)}`)
    .join("")}`;
  return (
    <div className="predicate-group">
      <div className="predicate-group-header">
        <span
          className="predicate-logic"
          role="group"
          aria-label={`Boolean group at level ${String(depth + 1)}`}
        >
          {(["and", "or"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={node.kind === kind}
              onClick={() => {
                onChange(
                  updateExpression(expression, path, (current) =>
                    current.kind === "and" || current.kind === "or"
                      ? { kind, children: current.children }
                      : current,
                  ),
                );
              }}
            >
              {kind.toUpperCase()}
            </button>
          ))}
        </span>
        <span className="predicate-count">
          {String(node.children.length)} conditions
        </span>
        <button
          type="button"
          disabled={node.children.length >= 8}
          onClick={() => {
            const next = newPredicate(rootTypes);
            if (next !== undefined) {
              onChange(
                updateExpression(expression, path, (current) =>
                  current.kind === "and" || current.kind === "or"
                    ? { ...current, children: [...current.children, next] }
                    : current,
                ),
              );
            }
          }}
        >
          Add condition
        </button>
        <button
          type="button"
          disabled={node.children.length >= 8 || depth >= 15}
          onClick={() => {
            const left = newPredicate(rootTypes);
            const right = newPredicate(rootTypes);
            if (left !== undefined && right !== undefined) {
              onChange(
                updateExpression(expression, path, (current) =>
                  current.kind === "and" || current.kind === "or"
                    ? {
                        ...current,
                        children: [
                          ...current.children,
                          { kind: "and", children: [left, right] },
                        ],
                      }
                    : current,
                ),
              );
            }
          }}
        >
          Add group
        </button>
        <button
          type="button"
          className="predicate-not-toggle"
          aria-pressed="false"
          onClick={() => {
            onChange(
              replaceExpression(expression, path, {
                kind: "not",
                child: node,
              }),
            );
          }}
        >
          NOT
        </button>
        {path.length === 0 ? null : (
          <>
            <button
              type="button"
              onClick={() => {
                onChange(replaceExpression(expression, path, undefined));
              }}
            >
              Remove group
            </button>
          </>
        )}
      </div>
      {errors[pathKey] === undefined ? null : (
        <p className="field-error" role="alert">{errors[pathKey]}</p>
      )}
      <div className="predicate-children">
        {node.children.map((child, childIndex) => (
          <PredicateNode
            {...props}
            node={child}
            path={[...path, childIndex]}
            depth={depth + 1}
            index={childIndex}
            parentPath={path}
            siblingCount={node.children.length}
            key={`${pathKey}.${String(childIndex)}`}
          />
        ))}
      </div>
    </div>
  );
}

function PredicateLeaf(props: PredicateNodeProps): ReactNode {
  const {
    node,
    path,
    expression,
    rootTypes,
    metadata,
    state,
    errors,
    onChange,
    index,
    parentPath,
    siblingCount,
  } = props;
  if (!isPredicateExpression(node)) {
    return null;
  }
  const pathKey = `predicate${path
    .map((segment) => `.${String(segment)}`)
    .join("")}`;
  const type = schemaTypeById(metadata, node.column);
  const operators = operatorsForType(type);
  const literalError = errors[`${pathKey}.literal`];
  return (
    <div className="predicate-leaf">
      <label>
        <span className="visually-hidden">Predicate column</span>
        <TruncatedText
          value={
            type === undefined
              ? "Unknown column"
              : `${type.name} · ${typeLabel(state, type)}`
          }
          className="query-column-select"
          renderControl={(describedBy) => (
            <select
              value={node.column}
              aria-label="Predicate column"
              aria-describedby={describedBy}
              onChange={(event) => {
                const column = Number(event.currentTarget.value);
                const nextType = schemaTypeById(metadata, column);
                const operator = operatorsForType(nextType)[0] ?? "eq";
                onChange(
                  replaceExpression(expression, path, {
                    kind: "predicate",
                    column,
                    operator,
                    literal: "",
                  }),
                );
              }}
            >
              {rootTypes
                .filter((candidate) => operatorsForType(candidate).length > 0)
                .map((candidate) => (
                  <option value={candidate.id} key={candidate.id}>
                    {candidate.name} · {typeLabel(state, candidate)}
                  </option>
                ))}
            </select>
          )}
        />
      </label>
      <label>
        <span className="visually-hidden">Predicate operator</span>
        <select
          value={node.operator}
          aria-label="Predicate operator"
          onChange={(event) => {
            const operator = event.currentTarget.value as FilterOperator;
            onChange(
              replaceExpression(expression, path, {
                ...node,
                operator,
                literal:
                  operator === "isNull" || operator === "isNotNull"
                    ? ""
                    : node.literal,
              }),
            );
          }}
        >
          {operators.map((operator) => (
            <option value={operator} key={operator}>
              {OPERATOR_LABELS[operator]}
            </option>
          ))}
        </select>
      </label>
      <PredicateValue
        type={type}
        operator={node.operator}
        value={node.literal}
        error={literalError}
        onChange={(literal) => {
          onChange(replaceExpression(expression, path, { ...node, literal }));
        }}
      />
      <span className="predicate-actions">
        {parentPath === undefined ? (
          <button
            type="button"
            title="Add condition"
            onClick={() => {
              const next = newPredicate(rootTypes);
              if (next !== undefined) {
                onChange({ kind: "and", children: [node, next] });
              }
            }}
          >
            Add condition
          </button>
        ) : null}
        <button
          type="button"
          title="Negate condition"
          className="predicate-not-toggle"
          aria-pressed="false"
          onClick={() => {
            onChange(
              replaceExpression(expression, path, {
                kind: "not",
                child: node,
              }),
            );
          }}
        >
          NOT
        </button>
        {parentPath === undefined ? null : (
          <>
            <button
              type="button"
              title="Move condition up"
              aria-label="Move condition up"
              disabled={index === 0}
              onClick={() => {
                onChange(
                  moveExpressionChild(
                    expression,
                    parentPath,
                    index ?? 0,
                    -1,
                  ),
                );
              }}
            >
              <Icon name="up" />
            </button>
            <button
              type="button"
              title="Move condition down"
              aria-label="Move condition down"
              disabled={index === (siblingCount ?? 1) - 1}
              onClick={() => {
                onChange(
                  moveExpressionChild(
                    expression,
                    parentPath,
                    index ?? 0,
                    1,
                  ),
                );
              }}
            >
              <Icon name="down" />
            </button>
          </>
        )}
        <button
          type="button"
          title="Remove condition"
          aria-label="Remove condition"
          onClick={() => {
            onChange(replaceExpression(expression, path, undefined));
          }}
        >
          <Icon name="close" />
        </button>
      </span>
      {errors[pathKey] === undefined ? null : (
        <p className="field-error" role="alert">{errors[pathKey]}</p>
      )}
      {literalError === undefined ? null : (
        <p className="field-error predicate-literal-error" role="alert">
          {literalError}
        </p>
      )}
    </div>
  );
}

function PredicateNode(props: PredicateNodeProps): ReactNode {
  const { node, path, depth, expression, onChange } = props;
  if (node.kind === "not") {
    return (
      <div className="predicate-not">
        <div className="predicate-not-header">
          <button
            type="button"
            className="predicate-not-toggle"
            aria-pressed="true"
            title="Remove NOT"
            onClick={() => {
              onChange(replaceExpression(expression, path, node.child));
            }}
          >
            NOT
          </button>
          <span>applies to this expression</span>
        </div>
        <PredicateNode
          {...props}
          node={node.child}
          path={[...path, "not"]}
          depth={depth + 1}
        />
      </div>
    );
  }
  if (node.kind === "and" || node.kind === "or") {
    return <PredicateGroup {...props} />;
  }
  return <PredicateLeaf {...props} />;
}

export function PredicateEditor(
  props: PredicateEditorProps,
): ReactNode {
  return (
    <div className="predicate-tree">
      <PredicateNode
        {...props}
        node={props.expression}
        path={[]}
        depth={0}
      />
    </div>
  );
}
