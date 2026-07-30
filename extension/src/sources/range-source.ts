export interface SourceIdentity {
  readonly uri: string;
  readonly size: bigint;
  readonly modifiedAt: bigint | undefined;
  readonly revision: string;
}

export interface RangeSource {
  readonly identity: SourceIdentity;
  readonly size: bigint;

  read(
    offset: bigint,
    length: bigint,
    signal: AbortSignal,
  ): Promise<Uint8Array>;

  close(): Promise<void>;
}
