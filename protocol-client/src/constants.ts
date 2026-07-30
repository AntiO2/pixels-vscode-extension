export const PROTOCOL_VERSION = Object.freeze({
  major: 1,
  minor: 1,
});

export const CORE_ABI_VERSION = 3;
export const MAX_RANGE_BYTES = 8n * 1024n * 1024n;
export const MAX_OPERATION_ROWS = 500;
export const DEFAULT_FILTER_ROWS = 100;
export const MAX_PROJECTION_COLUMNS = 128;
export const MAX_FILTER_LITERAL_BYTES = 4096;
export const MAX_FILTER_CURSOR_BYTES = 64;
export const DEFAULT_BUFFER_SOURCE_LIMIT = 64n * 1024n * 1024n;
