// What a zone is (AWS cloud, region, VPC, availability zone, public/private subnet, cluster, ...) and
// how each kind is drawn. Zones used to take the next colour of a palette in turn, which made a
// rainbow that meant nothing; a kind gives the same look to the same kind of boundary, close to the
// conventions of the AWS / Azure / Kubernetes architecture diagrams. Pure, used by build_diagram.

export const ZONE_KINDS = [
  "cloud",
  "region",
  "az",
  "vpc",
  "subnet-public",
  "subnet-private",
  "security-group",
  "autoscaling",
  "cluster",
  "namespace",
  "network",
  "dmz",
  "onprem",
  "trust",
  "tier",
  "group",
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export function isZoneKind(v: unknown): v is ZoneKind {
  return typeof v === "string" && (ZONE_KINDS as readonly string[]).includes(v);
}

export interface ZoneKindStyle {
  /** Border and title colour. */
  stroke: string;
  /** Fill; "transparent" = outline only. */
  fill: string;
  style: "solid" | "dashed" | "dotted";
  /** One line for the MCP description and the design guide. */
  about: string;
}

/**
 * Colours follow the AWS architecture icon guidelines where there is one (AWS Cloud #232F3E, Region
 * #00A4A6 dashed, AZ #147EBA dashed, VPC #8C4FFF, public subnet #7AA116, private subnet #00A4A6,
 * security group #DD344C, Auto Scaling #ED7100), with pale fills so nodes stay readable.
 */
export const ZONE_KIND_STYLES: Record<ZoneKind, ZoneKindStyle> = {
  cloud: { stroke: "#232f3e", fill: "#ffffff", style: "solid", about: "the cloud account / provider boundary" },
  region: { stroke: "#00a4a6", fill: "transparent", style: "dashed", about: "a cloud region" },
  az: { stroke: "#147eba", fill: "transparent", style: "dashed", about: "an availability zone (one column per AZ)" },
  vpc: { stroke: "#8c4fff", fill: "#faf7ff", style: "solid", about: "a VPC / VNet" },
  "subnet-public": { stroke: "#7aa116", fill: "#f2f6e8", style: "solid", about: "a public subnet" },
  "subnet-private": { stroke: "#00a4a6", fill: "#e6f6f7", style: "solid", about: "a private subnet" },
  "security-group": { stroke: "#dd344c", fill: "transparent", style: "dashed", about: "a security group / firewall rule set" },
  autoscaling: { stroke: "#ed7100", fill: "transparent", style: "dashed", about: "an auto scaling group" },
  cluster: { stroke: "#326ce5", fill: "#f0f4fd", style: "solid", about: "a Kubernetes / container cluster" },
  namespace: { stroke: "#326ce5", fill: "transparent", style: "dashed", about: "a Kubernetes namespace" },
  network: { stroke: "#495057", fill: "#f8f9fa", style: "solid", about: "a LAN, VLAN or network segment" },
  dmz: { stroke: "#e8590c", fill: "#fff4e6", style: "solid", about: "a DMZ / perimeter network" },
  onprem: { stroke: "#495057", fill: "#f1f3f5", style: "solid", about: "an on-premises site, data centre or home" },
  trust: { stroke: "#c92a2a", fill: "transparent", style: "dashed", about: "a trust / security boundary" },
  tier: { stroke: "#868e96", fill: "#f8f9fa", style: "solid", about: "an application tier (web, app, data)" },
  group: { stroke: "#868e96", fill: "transparent", style: "dashed", about: "a plain logical grouping" },
};

/** Rules in order: the first match wins (a "public subnet" is a subnet before it is anything else). */
const RULES: [RegExp, ZoneKind][] = [
  [/\bsecurity[ -]?group\b|\bsg\b|\bnsg\b/i, "security-group"],
  [/\bauto[ -]?scaling\b|\basg\b/i, "autoscaling"],
  [/\bpublic\b.*\bsubnets?\b|\bsubnets?\b.*\bpublic\b/i, "subnet-public"],
  [/\bsubnets?\b/i, "subnet-private"],
  [/\bdmz\b|\bperimeter\b/i, "dmz"],
  [/\bavailability zone\b|\baz\b|\baz[- ]?[a-f0-9]\b|\b[a-z]{2}-[a-z]+-\d[a-f]\b/i, "az"],
  [/\bvpc\b|\bvnet\b|\bvirtual network\b/i, "vpc"],
  [/\bnamespace\b|\bns\b/i, "namespace"],
  [/\bcluster\b|\bk8s\b|\bkubernetes\b|\beks\b|\baks\b|\bgke\b/i, "cluster"],
  [/\bregion\b|\b[a-z]{2}-[a-z]+-\d\b/i, "region"],
  [/\baws\b|\bazure\b|\bgcp\b|\bgoogle cloud\b|\bcloud\b/i, "cloud"],
  [/\bon[- ]?prem|\bdata ?cent(er|re)\b|\bdatacenter\b|\bhome\b|\boffice\b|\bhomelab\b/i, "onprem"],
  [/\btrust\b|\bboundary\b/i, "trust"],
  [/\bvlan\b|\blan\b|\bnetwork\b|\bsegment\b/i, "network"],
  [/\btier\b|\blayer\b/i, "tier"],
];

/** The kind a zone label suggests ("Public Subnet AZ-a" -> subnet-public, "VPC 10.0.0.0/16" -> vpc), or undefined. */
export function inferZoneKind(label: string | undefined): ZoneKind | undefined {
  if (!label) return undefined;
  for (const [re, kind] of RULES) if (re.test(label)) return kind;
  return undefined;
}

/**
 * Neutral look for a zone with no kind: slate outlines, paler fills further in, so nesting reads
 * without colour noise.
 */
export function neutralZoneStyle(depth: number): ZoneKindStyle {
  const fills = ["#f8f9fa", "#ffffff", "#f8f9fa", "#ffffff"];
  const strokes = ["#495057", "#868e96", "#adb5bd", "#adb5bd"];
  const i = Math.min(depth, fills.length - 1);
  return { stroke: strokes[i], fill: fills[i], style: "solid", about: "zone" };
}
