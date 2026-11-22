import { describe, expect, it } from "vitest";
import type { InventoryEntry } from "../shared/inventory";
import { compareCells, filterRows, sortRows } from "../shared/inventoryTable";

const row = (o: Partial<InventoryEntry>): InventoryEntry => ({
  id: "x", name: "", kind: "", type: "rectangle", zone: "", ip: "", hostname: "", vlan: "", role: "", owner: "", url: "", notes: "", extra: {}, ...o,
});

describe("compareCells", () => {
  it("orders IPv4 addresses by octet, not text", () => {
    expect(compareCells("10.0.0.9", "10.0.0.10")).toBeLessThan(0);
    expect(compareCells("10.0.1.1", "10.0.0.200")).toBeGreaterThan(0);
    expect(compareCells("10.0.0.1", "10.0.0.1")).toBe(0);
  });
  it("orders text naturally", () => {
    expect(compareCells("web-2", "web-10")).toBeLessThan(0);
    expect(compareCells("Alpha", "beta")).toBeLessThan(0);
  });
});

describe("sortRows", () => {
  const rows = [row({ id: "a", name: "web-10", ip: "10.0.0.10" }), row({ id: "b", name: "web-2", ip: "10.0.0.2" }), row({ id: "c", name: "db", ip: "" })];
  it("sorts ascending and descending", () => {
    expect(sortRows(rows, "name", "asc").map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(sortRows(rows, "name", "desc").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("keeps empty cells last in both directions", () => {
    expect(sortRows(rows, "ip", "asc").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortRows(rows, "ip", "desc").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("does not change the input and is stable", () => {
    const same = [row({ id: "1", role: "x" }), row({ id: "2", role: "x" })];
    expect(sortRows(same, "role", "asc").map((r) => r.id)).toEqual(["1", "2"]);
    expect(rows[0].id).toBe("a");
  });
});

describe("filterRows", () => {
  const rows = [row({ id: "a", name: "Core", role: "switch", extra: { rack: "A2" } }), row({ id: "b", name: "Edge", owner: "net team" })];
  it("matches every word in any cell, ignoring case", () => {
    expect(filterRows(rows, "core SWITCH").map((r) => r.id)).toEqual(["a"]);
    expect(filterRows(rows, "net").map((r) => r.id)).toEqual(["b"]);
  });
  it("searches extra properties", () => {
    expect(filterRows(rows, "a2").map((r) => r.id)).toEqual(["a"]);
  });
  it("returns everything for an empty query", () => {
    expect(filterRows(rows, "  ")).toHaveLength(2);
  });
});
