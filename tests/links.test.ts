import { describe, expect, it } from "vitest";
import { fileLink, linkProblem, normalizePosix, resolveLink } from "../shared/links";

const base = "/Users/b/diagrams/site.excalidraw";

describe("resolveLink", () => {
  it("accepts http and https URLs", () => {
    expect(resolveLink("https://example.com/a?b=1", null)).toEqual({ kind: "url", url: "https://example.com/a?b=1" });
    expect(resolveLink("  http://localhost:8080  ", null)).toEqual({ kind: "url", url: "http://localhost:8080/" });
  });

  it("rejects other schemes", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "mailto:a@b.c", "ftp://x/y.excalidraw", "vbscript:x", "JAVASCRIPT:alert(1)"]) {
      expect(resolveLink(bad, base).kind, bad).toBe("error");
    }
  });

  it("resolves relative drawing paths from the saved drawing's folder", () => {
    expect(resolveLink("rack.excalidraw", base)).toEqual({ kind: "file", path: "/Users/b/diagrams/rack.excalidraw" });
    expect(resolveLink("./sub/../rack.excalidraw", base)).toEqual({ kind: "file", path: "/Users/b/diagrams/rack.excalidraw" });
    expect(resolveLink("../other/net.excalidraw", base)).toEqual({ kind: "file", path: "/Users/b/other/net.excalidraw" });
  });

  it("needs a saved drawing for relative paths", () => {
    const r = resolveLink("rack.excalidraw", null);
    expect(r.kind).toBe("error");
  });

  it("accepts absolute, ~ and file: paths", () => {
    expect(resolveLink("/srv/a/b.excalidraw", null)).toEqual({ kind: "file", path: "/srv/a/b.excalidraw" });
    expect(resolveLink("~/Documents/../x.excalidraw", null)).toEqual({ kind: "file", path: "~/x.excalidraw" });
    expect(resolveLink("file:///srv/my%20dir/x.excalidraw", null)).toEqual({ kind: "file", path: "/srv/my dir/x.excalidraw" });
    expect(resolveLink("file://localhost/srv/x.excalidraw", null)).toEqual({ kind: "file", path: "/srv/x.excalidraw" });
    expect(resolveLink("file://evil-host/srv/x.excalidraw", null).kind).toBe("error");
  });

  it("only opens .excalidraw files", () => {
    expect(resolveLink("/etc/passwd", null).kind).toBe("error");
    expect(resolveLink("notes.txt", base).kind).toBe("error");
    expect(resolveLink("/a/B.EXCALIDRAW", null).kind).toBe("file");
  });

  it("rejects an empty link", () => {
    expect(resolveLink("   ", base).kind).toBe("error");
  });
});

describe("review fixes", () => {
  it("never climbs above ~ and keeps ~ in the middle of a path", () => {
    expect(resolveLink("~/../shared/plan.excalidraw", null).kind).toBe("error");
    expect(resolveLink("/a/~/b.excalidraw", null)).toEqual({ kind: "file", path: "/a/~/b.excalidraw" });
    expect(normalizePosix("~/a/../b")).toBe("~/b");
  });
  it("a relative link to a file named like a scheme stays followable", () => {
    const link = fileLink(base, "/Users/b/diagrams/Q1: plan.excalidraw");
    expect(link).toBe("./Q1: plan.excalidraw");
    expect(resolveLink(link, base)).toEqual({ kind: "file", path: "/Users/b/diagrams/Q1: plan.excalidraw" });
  });
});

describe("linkProblem", () => {
  it("is null for good links and a message for bad ones", () => {
    expect(linkProblem("https://x.dev")).toBeNull();
    expect(linkProblem("rack.excalidraw")).toBeNull();
    expect(linkProblem("javascript:alert(1)")).toMatch(/Links open/);
  });
});

describe("normalizePosix", () => {
  it("collapses dots and keeps the root", () => {
    expect(normalizePosix("/a/./b/../c")).toBe("/a/c");
    expect(normalizePosix("/../a")).toBe("/a");
    expect(normalizePosix("~/a/../b")).toBe("~/b");
  });
});

describe("fileLink", () => {
  it("is relative to the drawing's folder when near", () => {
    expect(fileLink(base, "/Users/b/diagrams/rack.excalidraw")).toBe("rack.excalidraw");
    expect(fileLink(base, "/Users/b/diagrams/sub/rack.excalidraw")).toBe("sub/rack.excalidraw");
    expect(fileLink(base, "/Users/b/other/net.excalidraw")).toBe("../other/net.excalidraw");
  });
  it("is absolute when the drawing is unsaved or far away", () => {
    expect(fileLink(null, "/a/b.excalidraw")).toBe("/a/b.excalidraw");
    expect(fileLink("/a/b/c/d/e.excalidraw", "/z/y.excalidraw")).toBe("/z/y.excalidraw");
  });
  it("round-trips through resolveLink", () => {
    for (const target of ["/Users/b/diagrams/rack.excalidraw", "/Users/b/other/net.excalidraw", "/Users/b/diagrams/a/b/c.excalidraw"]) {
      expect(resolveLink(fileLink(base, target), base)).toEqual({ kind: "file", path: target });
    }
  });
});
