import { describe, expect, it } from "vitest";
import { inferZoneKind, neutralZoneStyle, ZONE_KIND_STYLES, ZONE_KINDS } from "../shared/zoneKinds";

describe("zone kinds", () => {
  it("reads the kind from common labels", () => {
    const cases: [string, string | undefined][] = [
      ["AWS Cloud", "cloud"],
      ["AWS Cloud — Region us-east-1", "region"],
      ["us-east-1", "region"],
      ["Availability Zone A", "az"],
      ["AZ-a", "az"],
      ["us-east-1a", "az"],
      ["VPC 10.0.0.0/16", "vpc"],
      ["Public Subnets (AZ-a / AZ-b)", "subnet-public"],
      ["Private Subnets — Web Tier", "subnet-private"],
      ["Security group web-sg", "security-group"],
      ["Auto Scaling group", "autoscaling"],
      ["EKS cluster", "cluster"],
      ["Namespace: payments", "namespace"],
      ["Home LAN", "onprem"],
      ["VLAN 20 (IoT)", "network"],
      ["DMZ", "dmz"],
      ["Data tier", "tier"],
      ["Azure", "cloud"],
      ["Backend", undefined],
      [undefined as unknown as string, undefined],
    ];
    for (const [label, kind] of cases) expect(inferZoneKind(label), label).toBe(kind);
  });
  it("does not read DNS or Azure as other kinds", () => {
    expect(inferZoneKind("DNS")).toBeUndefined();
    expect(inferZoneKind("Azure subscription")).toBe("cloud");
  });
  it("has a style for every kind and neutral shades by depth", () => {
    for (const k of ZONE_KINDS) expect(ZONE_KIND_STYLES[k].stroke).toMatch(/^#[0-9a-f]{6}$/);
    expect(neutralZoneStyle(0).stroke).not.toBe(neutralZoneStyle(1).stroke);
    expect(neutralZoneStyle(9)).toEqual(neutralZoneStyle(3));
  });
});
