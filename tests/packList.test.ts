import { describe, expect, it } from "vitest";
import { filterAndSortPacks, matchesPack, type PackLike } from "../shared/packList";

const pack = (id: string, title: string, approxMB: number, installed = false, description = ""): PackLike => ({
  id,
  title,
  description,
  approxMB,
  license: "MIT",
  installed,
});
const packs = [
  pack("aws", "AWS Architecture Icons", 14, true, "Services and groups"),
  pack("network", "Network Devices", 2, false, "Routers, switches, firewalls"),
  pack("dashboard", "Dashboard Icons", 20, true, "Proxmox, Portainer, Pi-hole"),
];

describe("pack search", () => {
  it("matches every word in title, description or id", () => {
    expect(matchesPack(packs[2], "proxmox")).toBe(true);
    expect(matchesPack(packs[2], "proxmox plex")).toBe(false);
    expect(matchesPack(packs[1], "ROUTERS firewalls")).toBe(true);
    expect(matchesPack(packs[0], "")).toBe(true);
  });

  it("filters the list", () => {
    expect(filterAndSortPacks(packs, "icons", "name").map((p) => p.id)).toEqual(["aws", "dashboard"]);
    expect(filterAndSortPacks(packs, "zzz", "name")).toEqual([]);
  });
});

describe("pack sort", () => {
  it("sorts by name, size and installed", () => {
    expect(filterAndSortPacks(packs, "", "name").map((p) => p.id)).toEqual(["aws", "dashboard", "network"]);
    expect(filterAndSortPacks(packs, "", "size-asc").map((p) => p.id)).toEqual(["network", "aws", "dashboard"]);
    expect(filterAndSortPacks(packs, "", "size-desc").map((p) => p.id)).toEqual(["dashboard", "aws", "network"]);
    expect(filterAndSortPacks(packs, "", "installed").map((p) => p.id)).toEqual(["aws", "dashboard", "network"]);
  });

  it("does not mutate its input", () => {
    const copy = [...packs];
    filterAndSortPacks(packs, "", "size-desc");
    expect(packs).toEqual(copy);
  });
});
