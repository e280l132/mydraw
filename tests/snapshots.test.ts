import { describe, expect, it } from "vitest";
import { AUTO_SNAPSHOT_GAP_MS, describeSnapshotTime, shouldSnapshot, snapshotsToPrune } from "../shared/snapshots";

describe("shouldSnapshot", () => {
  const last = { time: 1_000_000, hash: "a" };
  it("always snapshots the first save", () => {
    expect(shouldSnapshot({ last: null, hash: "a", now: 5, auto: true })).toBe(true);
  });
  it("skips identical content", () => {
    expect(shouldSnapshot({ last, hash: "a", now: last.time + 10 * AUTO_SNAPSHOT_GAP_MS, auto: false })).toBe(false);
  });
  it("snapshots every manual save of changed content", () => {
    expect(shouldSnapshot({ last, hash: "b", now: last.time + 1000, auto: false })).toBe(true);
  });
  it("throttles autosaves", () => {
    expect(shouldSnapshot({ last, hash: "b", now: last.time + AUTO_SNAPSHOT_GAP_MS - 1, auto: true })).toBe(false);
    expect(shouldSnapshot({ last, hash: "b", now: last.time + AUTO_SNAPSHOT_GAP_MS, auto: true })).toBe(true);
  });
});

describe("snapshotsToPrune", () => {
  it("keeps the newest and returns the rest", () => {
    const ids = ["1000000001", "1000000005", "1000000003", "1000000002"];
    expect(snapshotsToPrune(ids, 2)).toEqual(["1000000002", "1000000001"]);
  });
  it("ignores names that are not snapshot ids", () => {
    expect(snapshotsToPrune(["meta.json", "1000000001"], 0)).toEqual(["1000000001"]);
    expect(snapshotsToPrune(["1000000001"], 5)).toEqual([]);
  });
});

describe("describeSnapshotTime", () => {
  const now = new Date(2026, 10, 21, 15, 0, 0).getTime();
  it("is relative for recent times", () => {
    expect(describeSnapshotTime(now - 10_000, now)).toBe("just now");
    expect(describeSnapshotTime(now - 5 * 60_000, now)).toBe("5 min ago");
  });
  it("names today, yesterday and older dates", () => {
    expect(describeSnapshotTime(new Date(2026, 10, 21, 9, 5).getTime(), now)).toBe("today 09:05");
    expect(describeSnapshotTime(new Date(2026, 10, 20, 23, 59).getTime(), now)).toBe("yesterday 23:59");
    expect(describeSnapshotTime(new Date(2026, 10, 1, 8, 0).getTime(), now)).toBe("2026-11-01 08:00");
  });
});
