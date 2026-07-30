import { InspectorError } from "@pixels-inspector/protocol-client";

export function sourceError(
  code:
    | "CANCELLED"
    | "INVALID_RANGE"
    | "SHORT_READ"
    | "SOURCE_CHANGED"
    | "SOURCE_IO"
    | "SOURCE_TOO_LARGE",
  message: string,
  cause?: unknown,
): InspectorError {
  return new InspectorError(code, message, true, {
    ...(cause === undefined ? {} : { cause }),
  });
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw sourceError("CANCELLED", "source read was cancelled", signal.reason);
  }
}

export function validateRange(
  sourceSize: bigint,
  offset: bigint,
  length: bigint,
): void {
  if (
    offset < 0n ||
    length < 0n ||
    offset > sourceSize ||
    length > sourceSize - offset
  ) {
    throw sourceError(
      "INVALID_RANGE",
      `range ${offset.toString()}+${length.toString()} exceeds source size ${sourceSize.toString()}`,
    );
  }
}
