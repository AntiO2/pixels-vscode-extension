import {
  decodeMetadataResultJson,
} from "@pixels-inspector/protocol-client";
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  continuationStatus,
  expressionSummary,
  operatorsForType,
  projectionForColumns,
  validateQueryPlan,
} from "../../webview/src/workspaces/query/query-plan.js";
import {
  EXPECTED_METADATA,
} from "../fixtures/expected.js";

const metadata = decodeMetadataResultJson(
  EXPECTED_METADATA.replace('"abi":3', '"abi":4'),
);

describe("Query Scan v2 plan model", () => {
  it("accepts the visible SELECT * LIMIT 20 default", () => {
    expect(
      validateQueryPlan(
        {
          projection: { kind: "all" },
          orderBy: [],
          offset: "0",
          limit: 20,
        },
        metadata,
      ),
    ).toEqual({ fields: {}, valid: true });
  });

  it("canonicalizes only canonical schema order as all", () => {
    const roots = [0, 1, 2, 3];
    expect(projectionForColumns(roots, roots)).toEqual({ kind: "all" });
    expect(projectionForColumns(roots, [2, 0])).toEqual({
      kind: "columns",
      columns: [2, 0],
    });
    expect(projectionForColumns(roots, [3, 2, 1, 0])).toEqual({
      kind: "columns",
      columns: [3, 2, 1, 0],
    });
    expect(projectionForColumns(roots, [0, 2, 3, 1])).toEqual({
      kind: "columns",
      columns: [0, 2, 3, 1],
    });
  });

  it("validates nested typed predicates and ordered keys", () => {
    const validation = validateQueryPlan(
      {
        projection: { kind: "columns", columns: [0, 1] },
        predicate: {
          kind: "and",
          children: [
            {
              kind: "predicate",
              column: 0,
              operator: "ge",
              literal: "1",
            },
            {
              kind: "not",
              child: {
                kind: "predicate",
                column: 1,
                operator: "isNull",
                literal: "",
              },
            },
          ],
        },
        orderBy: [
          { column: 1, direction: "desc", nulls: "last" },
          { column: 0, direction: "asc", nulls: "first" },
        ],
        offset: "4",
        limit: 20,
      },
      metadata,
    );
    expect(validation).toEqual({ fields: {}, valid: true });
  });

  it("reports nearest-field errors before Run", () => {
    const validation = validateQueryPlan(
      {
        projection: { kind: "columns", columns: [] },
        predicate: {
          kind: "predicate",
          column: 0,
          operator: "eq",
          literal: "",
        },
        orderBy: [],
        offset: "00",
        limit: 501,
      },
      metadata,
    );
    expect(validation.valid).toBe(false);
    expect(typeof validation.fields["projection"]).toBe("string");
    expect(typeof validation.fields["predicate.literal"]).toBe("string");
    expect(typeof validation.fields["offset"]).toBe("string");
    expect(typeof validation.fields["limit"]).toBe("string");
  });

  it("allows empty string predicates while keeping empty numeric literals invalid", () => {
    for (const operator of ["eq", "ne", "contains"] as const) {
      const emptyString = validateQueryPlan(
        {
          projection: { kind: "all" },
          predicate: {
            kind: "predicate",
            column: 1,
            operator,
            literal: "",
          },
          orderBy: [],
          offset: "0",
          limit: 20,
        },
        metadata,
      );
      expect(emptyString).toEqual({ fields: {}, valid: true });
    }

    const emptyNumber = validateQueryPlan(
      {
        projection: { kind: "all" },
        predicate: {
          kind: "predicate",
          column: 0,
          operator: "eq",
          literal: "",
        },
        orderBy: [],
        offset: "0",
        limit: 20,
      },
      metadata,
    );
    expect(typeof emptyNumber.fields["predicate.literal"]).toBe("string");
  });

  it("keeps group summaries and typed operators explicit", () => {
    expect(
      expressionSummary({
        kind: "or",
        children: [
          { kind: "predicate", column: 0, operator: "eq", literal: "1" },
          { kind: "predicate", column: 1, operator: "ne", literal: "2" },
        ],
      }),
    ).toBe("OR · 2 conditions");
    expect(operatorsForType(metadata.schema[0])).toContain("isNull");
  });

  it("treats hasMoreExact as knowledge, not as remaining rows", () => {
    expect(
      continuationStatus({
        continuationAvailable: true,
        hasMoreExact: false,
      }),
    ).toBe("Another matching row is not yet known");
    expect(
      continuationStatus({
        continuationAvailable: false,
        hasMoreExact: true,
      }),
    ).toBe("No further rows");
  });
});
