import { describe, expect, it } from "vitest";
import { humanize, pushRecent, safeSegment, scoreItem, searchItems, type LibraryItem } from "../shared/library";
import { ensureExtension, safeFileName, titleFromPath } from "../shared/names";
import { DEFAULT_SETTINGS, MAX_RECENT, addRecent, mergeSettings } from "../shared/settings";

describe("mergeSettings", () => {
  it("returns defaults for missing or invalid input", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(DEFAULT_SETTINGS, "nope")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and drops invalid ones", () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      theme: "dark",
      drawingStyle: "neon",
      autosave: "yes",
      recentFiles: ["/a.excalidraw", 42, "/b.excalidraw"],
      extra: true,
    });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, theme: "dark", recentFiles: ["/a.excalidraw", "/b.excalidraw"] });
  });

  it("does not mutate the base", () => {
    const base = { ...DEFAULT_SETTINGS, recentFiles: ["/x"] };
    mergeSettings(base, { recentFiles: [] });
    expect(base.recentFiles).toEqual(["/x"]);
  });

  it("caps the recent list", () => {
    const many = Array.from({ length: 30 }, (_, i) => `/f${i}`);
    expect(mergeSettings(DEFAULT_SETTINGS, { recentFiles: many }).recentFiles).toHaveLength(MAX_RECENT);
  });
});

describe("addRecent", () => {
  it("moves an existing path to the front without duplicates", () => {
    expect(addRecent(["/a", "/b", "/c"], "/c")).toEqual(["/c", "/a", "/b"]);
  });
  it("caps the length", () => {
    expect(addRecent(["/a", "/b", "/c"], "/d", 3)).toEqual(["/d", "/a", "/b"]);
  });
});

describe("names", () => {
  it("derives titles from paths", () => {
    expect(titleFromPath("/Users/x/Home Network.excalidraw")).toBe("Home Network");
    expect(titleFromPath("C:\\dia\\aws.excalidraw.json")).toBe("aws");
  });
  it("makes safe file names", () => {
    expect(safeFileName('a/b:c*"d"')).toBe("a-b-c--d-");
    expect(safeFileName("   ")).toBe("drawing");
  });
  it("adds an extension only when missing", () => {
    expect(ensureExtension("/x/net", "excalidraw")).toBe("/x/net.excalidraw");
    expect(ensureExtension("/x/net.EXCALIDRAW", "excalidraw")).toBe("/x/net.EXCALIDRAW");
  });
});

const item = (name: string, collection = "AWS", groups: string[] = [], tags: string[] = []): LibraryItem => ({
  id: `${collection}/${name}.svg`,
  collection,
  groups,
  name,
  tags,
  kind: "svg",
  file: `${collection}/${name}.svg`,
  mtime: 0,
});

describe("library search", () => {
  const items = [
    item("EC2 instance contents", "AWS", ["Groups"]),
    item("Amazon EC2", "AWS", ["Services", "Compute"]),
    item("Amazon EC2 Auto Scaling", "AWS", ["Services", "Compute"]),
    item("Load Balancer (Application)", "Network", ["Load Balancing"], ["lb", "alb"]),
    item("Firewall", "Network", ["Security"], ["firewall"]),
    item("Pod", "Kubernetes", ["Resources"], ["k8s", "pod"]),
    item("Aws Ec2", "Logos", ["A"], ["logo", "aws-ec2"]),
    item("Amazon Simple Storage Service", "AWS", ["Services", "Storage"], ["service", "aws", "s3"]),
    item("Amazon S3 on Outposts", "AWS", ["Services", "Storage"], ["service", "aws"]),
  ];

  it("ranks the closest name first", () => {
    expect(searchItems(items, "ec2")[0].name).toBe("Amazon EC2");
    expect(searchItems(items, "firewall")[0].name).toBe("Firewall");
    expect(searchItems(items, "s3")[0].name).toBe("Amazon Simple Storage Service");
  });

  it("requires every word to match and uses tags, groups and collection", () => {
    expect(searchItems(items, "lb app").map((i) => i.name)).toEqual(["Load Balancer (Application)"]);
    expect(searchItems(items, "k8s").map((i) => i.name)).toEqual(["Pod"]);
    expect(searchItems(items, "compute ec2")).toHaveLength(2);
    expect(searchItems(items, "router")).toEqual([]);
    expect(scoreItem(items[0], "")).toBe(0);
  });

  it("humanizes file names and keeps path segments safe", () => {
    expect(humanize("Load-Balancer_vpc.svg")).toBe("Load Balancer vpc");
    expect(humanize("core pair.stencil.json")).toBe("core pair");
    expect(safeSegment("../a/b:c")).toBe("-a-b-c");
    expect(safeSegment("   ")).toBe("untitled");
  });

  it("keeps recent stencils unique and capped", () => {
    expect(pushRecent(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});
