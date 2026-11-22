import { describe, expect, it } from "vitest";
import { applyProperties, extraProperties, propertyOf, readProperties } from "../shared/properties";

describe("propertyOf / readProperties", () => {
  it("reads aliases case-insensitively", () => {
    expect(propertyOf({ IPAddress: "10.0.0.1" }, "ip")).toBe("10.0.0.1");
    expect(propertyOf({ team: "net" }, "owner")).toBe("net");
    expect(propertyOf({}, "role")).toBe("");
    expect(propertyOf(undefined, "ip")).toBe("");
  });
  it("lists every known property", () => {
    expect(Object.keys(readProperties({ ip: "1", mydrawNode: "icon" })).sort()).toEqual(["hostname", "ip", "notes", "owner", "role", "url", "vlan"]);
  });
});

describe("extraProperties", () => {
  it("returns user keys that are not known properties or mydraw markers", () => {
    expect(extraProperties({ ip: "1", mydrawNode: "icon", rack: "A2", count: 3 })).toEqual({ rack: "A2", count: "3" });
  });
});

describe("applyProperties", () => {
  it("sets the canonical key and removes aliases", () => {
    expect(applyProperties({ address: "old", mydrawNode: "icon" }, { ip: "10.0.0.2" })).toEqual({ mydrawNode: "icon", ip: "10.0.0.2" });
  });
  it("removes a property with an empty value or null", () => {
    expect(applyProperties({ ip: "1", role: "core" }, { ip: "  ", role: null })).toBeUndefined();
    expect(applyProperties({ ip: "1", rack: "A" }, { ip: "" })).toEqual({ rack: "A" });
  });
  it("sets unknown keys as given and trims values", () => {
    expect(applyProperties(undefined, { rack: " A2 " })).toEqual({ rack: "A2" });
  });
  it("refuses mydraw-reserved keys", () => {
    expect(() => applyProperties({}, { mydrawNode: "x" })).toThrow(/reserved/);
  });
});
