export type InspectorErrorCode =
  | "ABI_MISMATCH"
  | "CANCELLED"
  | "CORE_ERROR"
  | "DIGEST_MISMATCH"
  | "DISPOSED"
  | "INTERNAL"
  | "INVALID_MESSAGE"
  | "INVALID_CURSOR"
  | "INVALID_RANGE"
  | "PROTOCOL_MISMATCH"
  | "SHORT_READ"
  | "SOURCE_CHANGED"
  | "SOURCE_IO"
  | "SOURCE_TOO_LARGE"
  | "STALE_RESPONSE"
  | "TIMEOUT"
  | "WORKER_CRASH";

export class InspectorError extends Error {
  public constructor(
    public readonly code: InspectorErrorCode,
    message: string,
    public readonly recoverable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InspectorError";
  }
}

export function toInspectorError(error: unknown): InspectorError {
  if (error instanceof InspectorError) {
    return error;
  }
  if (error instanceof Error) {
    return new InspectorError("INTERNAL", error.message, false, {
      cause: error,
    });
  }
  return new InspectorError("INTERNAL", "unknown inspector failure");
}
