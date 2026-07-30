import { InspectorError } from "./errors.js";

const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

export function parseUnsignedDecimal(
  value: string,
  field: string,
): bigint {
  if (!UNSIGNED_DECIMAL.test(value)) {
    throw new InspectorError(
      "INVALID_MESSAGE",
      `${field} must be an unsigned decimal string`,
    );
  }
  return BigInt(value);
}

export function toSafeLength(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InspectorError(
      "INVALID_RANGE",
      `${field} cannot be represented safely by this host`,
    );
  }
  return Number(value);
}
