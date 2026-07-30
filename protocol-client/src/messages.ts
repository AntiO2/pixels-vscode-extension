import { PROTOCOL_VERSION } from "./constants.js";
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
  | InspectPageMessage
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
  readonly operation: "metadata" | "page";
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
        rowGroup: integerField(value, "rowGroup"),
        column: integerField(value, "column"),
        rowOffset,
        rowCount: integerField(value, "rowCount"),
      };
    }
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
      if (operation !== "metadata" && operation !== "page") {
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
