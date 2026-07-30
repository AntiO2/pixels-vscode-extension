import {
  decodeCoreCapabilities,
  decodeFilterResult,
  decodeMetadataResult,
  decodePageResult,
  decodeRowGroupResult,
  decodeRowsResult,
} from "@pixels-inspector/protocol-client";

import type {
  AppError,
  HostMessage,
  SourceSummary,
} from "./model.js";

export interface VsCodeBridge {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeBridge;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  source: Record<string, unknown>,
  field: string,
): string {
  const value = source[field];
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function revisionOf(source: Record<string, unknown>): number {
  const revision = source["revision"];
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  ) {
    throw new Error("revision must be a non-negative safe integer");
  }
  return revision;
}

function decodeSource(value: unknown): SourceSummary {
  if (!isRecord(value)) {
    throw new Error("source must be an object");
  }
  return {
    uri: requiredString(value, "uri"),
    size: requiredString(value, "size"),
    revision: requiredString(value, "revision"),
  };
}

function decodeError(source: Record<string, unknown>): AppError {
  return {
    code: requiredString(source, "code"),
    message: requiredString(source, "message"),
    recoverable: source["recoverable"] === true,
  };
}

export function decodeHostMessage(value: unknown): HostMessage | undefined {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    return undefined;
  }
  if (value["kind"] === "preferences") {
    const preferences = value["preferences"];
    if (!isRecord(preferences)) {
      throw new Error("preferences must be an object");
    }
    const pageSize = preferences["pageSize"];
    const orientation = preferences["orientation"];
    const timestampDisplay = preferences["timestampDisplay"];
    if (
      (pageSize !== 25 &&
        pageSize !== 50 &&
        pageSize !== 100 &&
        pageSize !== 200 &&
        pageSize !== 500) ||
      (orientation !== "rows" && orientation !== "column") ||
      (timestampDisplay !== "utc" &&
        timestampDisplay !== "raw" &&
        timestampDisplay !== "local")
    ) {
      throw new Error("preferences contain unsupported values");
    }
    return {
      kind: "preferences",
      preferences: { pageSize, orientation, timestampDisplay },
    };
  }
  const revision = revisionOf(value);
  switch (value["kind"]) {
    case "loading":
      return {
        kind: "loading",
        revision,
        stage:
          typeof value["stage"] === "string" ? value["stage"] : "data",
      };
    case "metadata":
      return {
        kind: "metadata",
        revision,
        source: decodeSource(value["source"]),
        capabilities: decodeCoreCapabilities(value["capabilities"]),
        metadata: decodeMetadataResult(value["metadata"]),
      };
    case "rowGroup":
      return {
        kind: "rowGroup",
        revision,
        rowGroup: decodeRowGroupResult(value["rowGroup"]),
      };
    case "page":
      return {
        kind: "page",
        revision,
        page: decodePageResult(value["page"]),
      };
    case "rows":
      return {
        kind: "rows",
        revision,
        rows: decodeRowsResult(value["rows"]),
      };
    case "filter":
      return {
        kind: "filter",
        revision,
        filter: decodeFilterResult(value["filter"]),
      };
    case "empty":
      return { kind: "empty", revision };
    case "error":
      return { kind: "error", revision, error: decodeError(value) };
    default:
      return undefined;
  }
}

export function createBridge(): VsCodeBridge {
  return acquireVsCodeApi();
}
