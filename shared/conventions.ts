// How architecture diagrams of a domain are usually drawn (AWS, Azure, GCP, Kubernetes, networks,
// software flows), in terms of mydraw's build_diagram. The Ask Claude box adds the guides that match
// the request to its system prompt; the MCP tool get_conventions returns them on demand. Pure.

export const CONVENTION_DOMAINS = ["aws", "azure", "gcp", "kubernetes", "network", "flow"] as const;
export type ConventionDomain = (typeof CONVENTION_DOMAINS)[number];

interface Convention {
  title: string;
  /** Words that make a request about this domain. */
  keywords: RegExp;
  guide: string[];
}

const CONVENTIONS: Record<ConventionDomain, Convention> = {
  aws: {
    title: "AWS architecture",
    keywords: /\b(aws|amazon|ec2|s3|rds|aurora|dynamodb|lambda|vpc|route ?53|cloudfront|alb|elb|nlb|ecs|eks|fargate|sqs|sns|kinesis|api gateway|cognito|iam|nat gateway|internet gateway|availability zones?|multi-az|elasticache|redshift|bedrock)\b/i,
    guide: [
      "Nesting: zones AWS Cloud (kind cloud) > Region (kind region) > VPC (kind vpc); inside the VPC use a build_diagram `grid`: rows = tiers as subnets (public / web / app / data; kind subnet-public for public, subnet-private for the rest), columns = availability zones (kind az, dashed). Put each AZ's instances in their own cell (web-a in web/az-a, web-b in web/az-b) so the Multi-AZ shape is visible.",
      "Outside the VPC (top level or inside the Region): users/clients, Route 53, CloudFront, S3, IAM, CloudWatch and other regional or global services. The Internet Gateway sits on the VPC edge (in the VPC zone, not in a subnet).",
      "Grid orientation: for a top-to-bottom diagram rows = tiers and columns = AZs; for a left-to-right flow (users on the left) make the tiers the columns and the AZs the rows. A load balancer that spans AZs spans its tier (\"public/*\" when tiers are rows, \"*/public\" when tiers are columns): it is drawn between the two AZs, with one arrow to the target in each AZ. NAT gateways: one per AZ in the public subnet cells; draw outbound traffic as ONE secondary arrow from the private tier to the NAT (or omit it), never as a loop around the diagram.",
      "Databases: primary in one AZ cell and standby / replica in the other, joined by a short dashed Replication arrow (kind Replication). Caches beside the app tier.",
      "To change a built diagram (transpose the grid, move a node to another tier, add a tier), get_diagram_spec and rebuild with build_diagram {replace}.",
      "Icons: AWS stencils (\"Amazon EC2\", \"Elastic Load Balancing\", \"Amazon RDS\", \"Amazon Route 53\", \"Amazon VPC NAT Gateway\", \"Amazon VPC Internet Gateway\", \"Amazon S3\"); captions short (\"Web\", \"App\", \"RDS primary\"), the AZ goes in the subtitle only when the cell does not already say it.",
      "Arrows: kinds Traffic (primary, the request path), Replication (dashed), DNS / Management (secondary). Number the request path with edge `step` and explain it in `steps` when the user wants to understand the flow.",
    ],
  },
  azure: {
    title: "Azure architecture",
    keywords: /\b(azure|vnet|app service|aks|cosmos ?db|azure sql|front door|application gateway|entra|key vault|blob storage|functions app|resource group|subscription)\b/i,
    guide: [
      "Nesting: Subscription / Resource group (kind cloud or group) > Region (kind region) > VNet (kind vpc) > subnets (kind subnet-private, or subnet-public for internet-facing ones); availability zones as a build_diagram `grid` (columns kind az) when zone redundancy matters.",
      "Front Door / Traffic Manager / DNS outside the region; Application Gateway or Load Balancer in its own subnet; App Service / AKS / VMs in app subnets; Azure SQL / Cosmos DB in a data subnet or behind private endpoints.",
      "Icons: Azure stencils (\"Virtual Machine\", \"App Service\", \"Azure SQL\", \"Application Gateway\", \"Key Vault\"). Arrows: Traffic primary, Replication dashed, Management secondary.",
    ],
  },
  gcp: {
    title: "Google Cloud architecture",
    keywords: /\b(gcp|google cloud|gke|cloud run|cloud sql|bigquery|pub\/?sub|cloud storage|compute engine|spanner|firestore|cloud load balancing)\b/i,
    guide: [
      "Nesting: Project (kind cloud) > VPC network (kind vpc, global) > Region (kind region) > subnet (kind subnet-private); zones as a build_diagram `grid` (columns kind az) when instances are per zone.",
      "Cloud Load Balancing and Cloud DNS outside the VPC; Cloud Run / GKE / Compute Engine in the region; Cloud SQL / Spanner / BigQuery as data; Pub/Sub as a queue role.",
      "Icons: GCP stencils (\"Compute Engine\", \"Cloud Run\", \"Cloud SQL\", \"Pub/Sub\"). Arrows: Traffic primary, Async (Pub/Sub) dashed, Management secondary.",
    ],
  },
  kubernetes: {
    title: "Kubernetes",
    keywords: /\b(kubernetes|k8s|k3s|pods?|deployments?|helm|ingress|namespaces?|statefulset|daemonset|service mesh|istio|kubelet|eks|aks|gke)\b/i,
    guide: [
      "Nesting: Cluster (kind cluster) > Namespace (kind namespace, dashed) > workloads. Nodes / node pools only when the user asks about scheduling; otherwise show logical objects.",
      "Flow left to right: client -> Ingress / Gateway -> Service -> Deployment (pods) -> data (StatefulSet, managed DB outside the cluster). One node per Deployment with the replica count in its subtitle (\"3 replicas\") instead of one node per pod.",
      "Icons: Kubernetes stencils (\"ing\", \"svc\", \"deploy\", \"pod\", \"sts\", \"cm\", \"secret\", \"pvc\"). Arrows: Traffic primary; config/secret mounts secondary dashed.",
    ],
  },
  network: {
    title: "Networks and homelabs",
    keywords: /\b(homelab|home lab|network|lan|wan|vlan|router|switch|firewall|pfsense|opnsense|unifi|wifi|access point|nas|proxmox|truenas|docker host|reverse proxy|traefik|nginx proxy|pi-?hole|subnet|dmz|vpn|wireguard|tailscale)\b/i,
    guide: [
      "Top to bottom: Internet / ISP at the top, then modem, router / firewall, core switch, then one zone per VLAN or segment (kind network; DMZ kind dmz; the house or site kind onprem). Put the VLAN id and subnet in the zone label (\"VLAN 20 IoT · 10.0.20.0/24\").",
      "Hosts carry their IP / hostname in `data` and show it with `showData: [\"ip\"]`; servers that host containers or VMs get a nested zone (kind group) holding them.",
      "Arrows: physical links (kind Ethernet, solid), Wi-Fi (dashed), VPN tunnels (kind VPN, dotted, secondary). Use network stencils (router, switch, firewall, access point, NAS, server) and logos for apps.",
    ],
  },
  flow: {
    title: "Software and data flows",
    keywords: /\b(flow|pipeline|etl|request|sequence|microservices?|api|frontend|backend|service|queue|event|kafka|webhook|auth|login|checkout|ci\/?cd|deploy)\b/i,
    guide: [
      "Direction: left to right for request paths, top to bottom for pipelines. Entry (user, client) first, data stores last; group by layer or bounded context with zones (kind tier or group), not by technology.",
      "Number the main path with edge `step` (1, 2, 3 ...) and describe each in `steps` when the user wants to understand the sequence; give async hops (queues, events) kind Async, dashed.",
      "Put the most important path in `weight: primary`; for several flows through the same system use `views` (one page per flow) instead of drawing every arrow on one page.",
    ],
  },
};

export function isConventionDomain(v: unknown): v is ConventionDomain {
  return typeof v === "string" && (CONVENTION_DOMAINS as readonly string[]).includes(v);
}

/** The domains a text is about, most specific first (cloud providers before generic networks and flows). */
export function matchConventions(text: string): ConventionDomain[] {
  const hits = CONVENTION_DOMAINS.filter((d) => CONVENTIONS[d].keywords.test(text));
  // A cloud provider's own guide covers its networking; keep "network" only without one.
  const cloud = hits.some((d) => d === "aws" || d === "azure" || d === "gcp");
  return hits.filter((d) => !(cloud && d === "network"));
}

/** The guide for a domain as text (a heading line, then one "- " line per rule). */
export function conventionText(domain: ConventionDomain): string {
  const c = CONVENTIONS[domain];
  return [`Conventions for ${c.title} diagrams:`, ...c.guide.map((g) => `- ${g}`)].join("\n");
}

/** Guides for the domains a text is about (at most `max`), joined; empty when none match. */
export function conventionsFor(text: string, max = 2): string {
  return matchConventions(text)
    .slice(0, max)
    .map(conventionText)
    .join("\n\n");
}
