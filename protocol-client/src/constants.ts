export const PROTOCOL_VERSION = Object.freeze({
  major: 1,
  minor: 2,
});

export const CORE_ABI_VERSION = 4;
export const MAX_RANGE_BYTES = 8n * 1024n * 1024n;
export const MAX_OPERATION_ROWS = 500;
export const DEFAULT_FILTER_ROWS = 100;
export const MAX_PROJECTION_COLUMNS = 128;
export const MAX_FILTER_LITERAL_BYTES = 4096;
export const MAX_FILTER_CURSOR_BYTES = 64;
export const DEFAULT_SCAN_ROWS = 20;
export const MAX_SCAN_ROWS = 500;
export const MAX_SCAN_PLAN_BYTES = 128 * 1024;
export const MAX_EXPRESSION_NODES = 64;
export const MAX_EXPRESSION_DEPTH = 16;
export const MAX_PREDICATE_LEAVES = 32;
export const MAX_SCAN_LITERAL_BYTES = 4096;
export const MAX_LITERAL_POOL_BYTES = 64 * 1024;
export const MAX_ORDER_KEYS = 8;
export const MAX_ORDERED_WINDOW_ROWS = 4096;
export const MAX_SCAN_CURSOR_BYTES = 128;
export const SCAN_PROGRESS_BYTES = 64;
export const DEFAULT_BUFFER_SOURCE_LIMIT = 64n * 1024n * 1024n;
