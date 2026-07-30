export interface EmscriptenInspectorModule {
  readonly HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _pixels_inspector_abi_version(): number;
  _pixels_inspector_capabilities_size(sizePointer: number): number;
  _pixels_inspector_copy_capabilities(
    destination: number,
    destinationSize: bigint,
  ): number;
  _pixels_inspector_create(fileSize: bigint, handlePointer: number): number;
  _pixels_inspector_destroy(handle: number): number;
  _pixels_inspector_begin_metadata(handle: number): number;
  _pixels_inspector_begin_row_group(
    handle: number,
    rowGroup: number,
  ): number;
  _pixels_inspector_begin_page(
    handle: number,
    rowGroup: number,
    column: number,
    rowOffset: bigint,
    rowCount: number,
  ): number;
  _pixels_inspector_next_range(
    handle: number,
    offsetPointer: number,
    lengthPointer: number,
  ): number;
  _pixels_inspector_supply_range(
    handle: number,
    offset: bigint,
    length: bigint,
    bytesPointer: number,
  ): number;
  _pixels_inspector_result_size(handle: number, sizePointer: number): number;
  _pixels_inspector_copy_result(
    handle: number,
    destination: number,
    destinationSize: bigint,
  ): number;
  _pixels_inspector_error_size(handle: number, sizePointer: number): number;
  _pixels_inspector_copy_error(
    handle: number,
    destination: number,
    destinationSize: bigint,
  ): number;
  _pixels_inspector_cancel(handle: number): number;
}

export interface EmscriptenModuleOptions {
  readonly wasmBinary: Uint8Array;
  readonly noInitialRun?: boolean;
  readonly print?: (text: string) => void;
  readonly printErr?: (text: string) => void;
}

export type InspectorModuleFactory = (
  options: EmscriptenModuleOptions,
) => Promise<EmscriptenInspectorModule>;
