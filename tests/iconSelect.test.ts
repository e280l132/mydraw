import { describe, expect, it } from "vitest";
import { classifyInfraIcon, dashboardGroup, keepDashboardIcon, keepDevicon } from "../shared/iconSelect";

describe("classifyInfraIcon", () => {
  it("sorts infrastructure icons into categories", () => {
    expect(classifyInfraIcon("router")).toBe("Network");
    expect(classifyInfraIcon("server-network")).toBe("Network");
    expect(classifyInfraIcon("server")).toBe("Servers & Storage");
    expect(classifyInfraIcon("database")).toBe("Servers & Storage");
    expect(classifyInfraIcon("cloud")).toBe("Cloud & Containers");
    expect(classifyInfraIcon("shield")).toBe("Security");
    expect(classifyInfraIcon("laptop")).toBe("Devices");
  });

  it("matches whole words only", () => {
    expect(classifyInfraIcon("language")).toBeNull(); // not "lan"
    expect(classifyInfraIcon("banana")).toBeNull();
  });

  it("skips variants and very specific names", () => {
    expect(classifyInfraIcon("server-off")).toBeNull();
    expect(classifyInfraIcon("server-plus")).toBeNull();
    expect(classifyInfraIcon("server-security-network-outline")).toBeNull();
  });
});

describe("keepDevicon", () => {
  it("keeps the colored mark, not wordmarks or line variants", () => {
    expect(keepDevicon("docker-original")).toBe(true);
    expect(keepDevicon("docker-plain")).toBe(false);
    expect(keepDevicon("docker-original-wordmark")).toBe(false);
    expect(keepDevicon("docker-line")).toBe(false);
    expect(keepDevicon("linux")).toBe(true);
  });
});

describe("dashboard icons", () => {
  it("drops dark/light duplicates and huge files", () => {
    expect(keepDashboardIcon("proxmox.svg", 4000)).toBe(true);
    expect(keepDashboardIcon("proxmox-light.svg", 4000)).toBe(false);
    expect(keepDashboardIcon("1password-dark.svg", 4000)).toBe(false);
    expect(keepDashboardIcon("photo.svg", 500 * 1024)).toBe(false);
  });

  it("groups by the first category", () => {
    expect(dashboardGroup({ categories: ["Server-Panels", "Cloud"] })).toBe("Server Panels");
    expect(dashboardGroup(undefined)).toBe("Other");
  });
});
