import { describe, expect, it } from "vitest";
import { nextLabel } from "../shared/labelNumber";

describe("nextLabel", () => {
  it("counts up a trailing number", () => {
    expect(nextLabel("web-1", [])).toBe("web-2");
    expect(nextLabel("node 9", [])).toBe("node 10");
    expect(nextLabel("10.0.0.1", [])).toBe("10.0.0.2");
  });

  it("keeps zero padding", () => {
    expect(nextLabel("db01", [])).toBe("db02");
    expect(nextLabel("db09", [])).toBe("db10");
    expect(nextLabel("db099", [])).toBe("db100");
  });

  it("adds 2 to a label without a number", () => {
    expect(nextLabel("Server", [])).toBe("Server 2");
    expect(nextLabel("Server ", [])).toBe("Server 2");
  });

  it("skips names already in the drawing", () => {
    expect(nextLabel("web-1", ["web-1", "web-2", "WEB-3"])).toBe("web-4");
    expect(nextLabel("Server", ["Server", "Server 2"])).toBe("Server 3");
  });

  it("changes only the first line", () => {
    expect(nextLabel("web-1\n10.0.0.1", ["web-2\nx"])).toBe("web-3\n10.0.0.1");
  });

  it("leaves empty labels alone", () => {
    expect(nextLabel("", [])).toBeNull();
    expect(nextLabel("  \nx", [])).toBeNull();
  });
});
