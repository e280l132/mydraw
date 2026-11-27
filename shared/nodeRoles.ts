// Node roles for the polished diagram look (pure; tests/nodeRoles.test.ts). A role is what a node
// IS in the system (entry point, data store, ...); the polished look colours each role with one hue:
// a pale tint as fill and a deeper shade of the same hue as stroke, so a reader sees the parts at a
// glance. Colours come from the ramp palette (shared/palettes.ts), so lint never calls them
// off-palette. The design guide in shared/recipes.ts tells Claude the same mapping.
import { resolveColor } from "./palettes";

export const NODE_ROLES = ["entry", "edge", "compute", "service", "data", "queue", "storage", "security", "monitoring", "external"] as const;
export type NodeRole = (typeof NODE_ROLES)[number];

export interface RoleStyle {
  /** Hue name in the ramp palette. */
  hue: string;
  fill: string;
  stroke: string;
  /** External systems: dashed outline. */
  strokeStyle?: "dashed";
  /** Legend name. */
  title: string;
}

const ROLE_HUES: Record<NodeRole, { hue: string; title: string; strokeStyle?: "dashed" }> = {
  entry: { hue: "blue", title: "Users / entry" },
  edge: { hue: "violet", title: "Network / edge" },
  compute: { hue: "teal", title: "Compute" },
  service: { hue: "sky", title: "Services" },
  data: { hue: "green", title: "Data stores" },
  queue: { hue: "orange", title: "Queues / streams" },
  storage: { hue: "emerald", title: "Storage" },
  security: { hue: "red", title: "Security" },
  monitoring: { hue: "slate", title: "Monitoring / management" },
  external: { hue: "gray", title: "External", strokeStyle: "dashed" },
};

const shade = (hue: string, n: number) => resolveColor(`${hue}-${n}`) ?? "#868e96";

export const ROLE_STYLES: Record<NodeRole, RoleStyle> = Object.fromEntries(
  NODE_ROLES.map((r) => {
    const { hue, title, strokeStyle } = ROLE_HUES[r];
    return [r, { hue, title, fill: shade(hue, 50), stroke: shade(hue, 700), ...(strokeStyle ? { strokeStyle } : {}) }];
  }),
) as Record<NodeRole, RoleStyle>;

export const isNodeRole = (v: unknown): v is NodeRole => NODE_ROLES.includes(v as NodeRole);

// First match wins: more specific roles before generic ones. Matched against words of the
// kind, icon, shape and label (lower case).
const RULES: Array<[NodeRole, RegExp]> = [
  ["security", /\b(firewall|waf|vault|iam|auth|keycloak|okta|sso|ids|ips|guard|shield|certificate|kms|secrets?|vpn)\b/],
  ["monitoring", /\b(monitor(ing)?|grafana|prometheus|loki|elk|kibana|datadog|sentry|logs?|logging|metrics|alert(manager|ing)?|uptime|zabbix|nagios|portainer|proxmox|management|bastion|jump)\b/],
  ["queue", /\b(queue|kafka|sqs|sns|rabbitmq|rabbit|nats|pub\/?sub|pubsub|event ?bus|eventbridge|kinesis|stream|mqtt|broker)\b/],
  ["data", /\b(db|database|postgres(ql)?|mysql|mariadb|mongo(db)?|redis|memcached|cache|dynamodb|rds|aurora|sql|sqlite|cassandra|elasticsearch|opensearch|bigquery|warehouse|snowflake|clickhouse|influx(db)?|cosmos|firestore|spanner)\b/],
  ["storage", /\b(s3|bucket|storage|blob|nas|san|nfs|smb|disk|volume|backup|archive|glacier|minio|ceph|truenas|synology|files?)\b/],
  ["edge", /\b(load ?balancer|lb|alb|elb|nlb|nginx|haproxy|traefik|caddy|envoy|ingress|gateway|api ?gateway|cdn|cloudfront|dns|route ?53|router|switch|proxy|reverse ?proxy|vpc|subnet|nat|wifi|access ?point|modem)\b/],
  ["entry", /\b(users?|clients?|browser|mobile|app user|customer|internet|actor|person|people|web ?client|laptop|desktop|phone)\b/],
  ["external", /\b(external|third[- ]party|saas|partner|stripe|twilio|sendgrid|github|slack|upstream|vendor)\b/],
  ["compute", /\b(ec2|vm|virtual machine|server|host|node|instance|container|docker|pod|k8s|kubernetes|lambda|function|compute|worker|runner|lxc|cluster|fargate|ecs|eks|gke|aks)\b/],
];

/** A node as far as its role is concerned. */
export interface RoleInput {
  role?: string | null;
  kind?: string;
  shape?: string;
  icon?: string;
  label?: string;
}

/** The node's role: the explicit one, else a guess from shape, kind, icon and label (default "service"). */
export function inferRole(n: RoleInput): NodeRole {
  if (isNodeRole(n.role)) return n.role;
  if (n.shape === "cylinder") return "data";
  if (n.shape === "queue") return "queue";
  if (n.shape === "actor") return "entry";
  if (n.shape === "cloud") return "external";
  if (n.shape === "server") return "compute";
  if (n.shape === "folder" || n.shape === "document") return "storage";
  const text = [n.kind, n.icon, n.label].filter(Boolean).join(" ").toLowerCase().replace(/[_:]+/g, " ");
  for (const [role, re] of RULES) if (re.test(text)) return role;
  return "service";
}
