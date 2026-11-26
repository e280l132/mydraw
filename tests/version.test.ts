import { describe, expect, it } from "vitest";
import { bumpVersion, compareVersions, displayVersion, parseVersion, tagVersion } from "../shared/version";

describe("version", () => {
  it("parses", () => {
    expect(parseVersion("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0, pre: "" });
    expect(parseVersion("v0.2")).toEqual({ major: 0, minor: 2, patch: 0, pre: "" });
    expect(parseVersion("1.0.0-beta.1")?.pre).toBe("beta.1");
    expect(parseVersion("x")).toBeNull();
    expect(parseVersion("1")).toBeNull();
  });

  it("compares", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v0.1.0", "0.1")).toBe(0);
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("junk", "0.0.1")).toBeLessThan(0);
  });

  it("shows major.minor, and the patch only when set", () => {
    expect(displayVersion("0.1.0")).toBe("0.1");
    expect(displayVersion("0.1.1")).toBe("0.1.1");
    expect(displayVersion("1.0.0-rc.1")).toBe("1.0-rc.1");
  });

  it("reads release tags, ignoring prereleases", () => {
    expect(tagVersion("v0.2.0")).toBe("0.2.0");
    expect(tagVersion("v0.3")).toBe("0.3.0");
    expect(tagVersion("v1.0.0-beta")).toBeNull();
  });

  it("bumps", () => {
    expect(bumpVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpVersion("0.9.3", "major")).toBe("1.0.0");
    expect(bumpVersion("0.1.0", "0.1.0")).toBe("0.1.0");
    expect(() => bumpVersion("0.1.0", "huge")).toThrow();
  });
});
