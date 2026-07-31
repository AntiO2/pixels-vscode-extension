import type { ScanProgressV2 } from "@pixels-inspector/protocol-client";

export interface TimedScanProgress {
  readonly progress: ScanProgressV2;
  readonly elapsedMs: number;
}

export class ScanProgressClock {
  private readonly startedAt = performance.now();
  private readonly timer: ReturnType<typeof setInterval>;
  private latest: ScanProgressV2 | undefined;
  private stopped = false;

  public constructor(
    private readonly post: (update: TimedScanProgress) => void,
    intervalMs = 250,
  ) {
    this.timer = setInterval(() => {
      this.emit();
    }, intervalMs);
  }

  public get elapsedMs(): number {
    return Math.max(0, Math.round(performance.now() - this.startedAt));
  }

  public update(progress: ScanProgressV2): void {
    if (this.stopped) {
      return;
    }
    this.latest = progress;
    this.emit();
  }

  public stop(): number {
    if (!this.stopped) {
      this.stopped = true;
      clearInterval(this.timer);
    }
    return this.elapsedMs;
  }

  private emit(): void {
    if (this.stopped || this.latest === undefined) {
      return;
    }
    this.post({
      progress: this.latest,
      elapsedMs: this.elapsedMs,
    });
  }
}
