import type { ScanProgressV2 } from "@pixels-inspector/protocol-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScanProgressClock } from "../../extension/src/worker/scan-progress-clock.js";

const progress: ScanProgressV2 = {
  phase: "scanning",
  rowGroupsTotal: 2,
  rowGroupsConsidered: 1,
  scannedRowGroups: 1,
  prunedRowGroups: 0,
  currentRowGroup: 1,
  retainedCandidates: 0,
  rowsTotal: "10",
  scannedRows: "5",
  prunedRows: "0",
  matchedRows: "2",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("ScanProgressClock", () => {
  it("posts Core changes immediately and elapsed-only ticks every 250 ms", () => {
    vi.useFakeTimers();
    const post = vi.fn();
    const clock = new ScanProgressClock(post);

    clock.update(progress);
    expect(post).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({
      progress,
      elapsedMs: 500,
    });
    clock.stop();
  });

  it("clears its timer and ignores late Core progress after stop", () => {
    vi.useFakeTimers();
    const post = vi.fn();
    const clock = new ScanProgressClock(post);
    clock.update(progress);
    const elapsed = clock.stop();
    clock.stop();
    vi.advanceTimersByTime(1_000);
    clock.update({ ...progress, scannedRows: "6" });

    expect(elapsed).toBe(0);
    expect(post).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not fabricate a Core progress snapshot before one arrives", () => {
    vi.useFakeTimers();
    const post = vi.fn();
    const clock = new ScanProgressClock(post);
    vi.advanceTimersByTime(1_000);
    clock.stop();
    expect(post).not.toHaveBeenCalled();
  });
});
