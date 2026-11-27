import { describe, expect, it } from "vitest";
import { CONVENTION_DOMAINS, conventionText, conventionsFor, matchConventions } from "../shared/conventions";

describe("conventions", () => {
  it("matches domains from a request", () => {
    expect(matchConventions("3-tier web app on AWS with an ALB and RDS")).toContain("aws");
    expect(matchConventions("AKS cluster with Cosmos DB")).toEqual(expect.arrayContaining(["azure", "kubernetes"]));
    expect(matchConventions("my homelab with proxmox and a pfsense firewall")).toContain("network");
    expect(matchConventions("hello")).toEqual([]);
  });
  it("leaves generic networking out when a cloud guide covers it", () => {
    expect(matchConventions("AWS VPC with a NAT gateway and subnets")).not.toContain("network");
  });
  it("has text for every domain and caps how many are added", () => {
    for (const d of CONVENTION_DOMAINS) expect(conventionText(d)).toMatch(/^Conventions for /);
    const many = conventionsFor("AWS EKS kubernetes api pipeline", 2);
    expect(many.match(/Conventions for/g)!.length).toBe(2);
  });
});
