// Downloads official icon packs into the stencil library. Plain Node (no Electron imports) so it can
// also run from scripts/fetch-packs.mjs. Downloads are untrusted: each is unpacked into its own empty
// temp folder, only .svg files are copied out, and nothing from them is executed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CollectionMeta } from "../../shared/library";
import { safeSegment } from "../../shared/library";

export interface PackInfo {
  id: string;
  collection: string;
  title: string;
  description: string;
  approxMB: number;
  license: string;
  licenseUrl: string;
}

export const PACKS: PackInfo[] = [
  {
    id: "aws",
    collection: "AWS",
    title: "AWS Architecture Icons",
    description: "Services, resources, groups and categories (official AWS package)",
    approxMB: 14,
    license: "AWS Architecture Icons terms: free to use in architecture diagrams",
    licenseUrl: "https://aws.amazon.com/architecture/icons/",
  },
  {
    id: "azure",
    collection: "Azure",
    title: "Azure Architecture Icons",
    description: "Azure service icons (official Microsoft package)",
    approxMB: 1,
    license: "Microsoft Azure icon terms: use in architecture diagrams",
    licenseUrl: "https://learn.microsoft.com/en-us/azure/architecture/icons/",
  },
  {
    id: "gcp",
    collection: "Google Cloud",
    title: "Google Cloud Icons",
    description: "Product, category and legacy service icons (official Google package)",
    approxMB: 4,
    license: "Google Cloud icon terms",
    licenseUrl: "https://cloud.google.com/icons",
  },
  {
    id: "k8s",
    collection: "Kubernetes",
    title: "Kubernetes Icons",
    description: "Resources, control plane and infrastructure (kubernetes/community)",
    approxMB: 1,
    license: "Apache-2.0 / CC BY 4.0 (kubernetes/community)",
    licenseUrl: "https://github.com/kubernetes/community/tree/main/icons",
  },
  {
    id: "network",
    collection: "Network",
    title: "Network Devices",
    description: "Routers, switches, firewalls, load balancers, VPN, Wi-Fi… (IBM Carbon icons)",
    approxMB: 2,
    license: "Apache-2.0 (IBM Carbon)",
    licenseUrl: "https://github.com/carbon-design-system/carbon",
  },
  {
    id: "logos",
    collection: "Logos",
    title: "Product Logos",
    description: "2,300 vendor and product logos (Docker, Cloudflare, Grafana, Postgres…)",
    approxMB: 4,
    license: "CC0-1.0 (Iconify logos by Gil Barbara)",
    licenseUrl: "https://github.com/gilbarbara/logos",
  },
];

export type Progress = (msg: string) => void;

const UA = { "User-Agent": "mydraw-stencil-downloader" };

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: UA, redirect: "follow" });
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA, redirect: "follow" });
  if (!res.ok) throw new Error(`request failed (${res.status}): ${url}`);
  return res.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T;
}

/** Find the current zip link on a vendor page (they change every release). */
async function findZip(page: string, pattern: RegExp, fallback?: string): Promise<string> {
  try {
    const m = (await fetchText(page)).match(pattern);
    if (m) return m[0].startsWith("//") ? `https:${m[0]}` : m[0];
  } catch {
    // fall through to fallback
  }
  if (fallback) return fallback;
  throw new Error(`could not find the download link on ${page}`);
}

function unzip(zip: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  // -qq quiet, -o overwrite; unzip refuses entries that escape dest ("../").
  execFileSync("unzip", ["-qq", "-o", zip, "-d", dest], { stdio: "ignore" });
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__MACOSX" || e.name.startsWith("._")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const words = (s: string) => s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
const titleCase = (s: string) => words(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Collects files for one pack, then writes them into place. */
class PackWriter {
  private meta: CollectionMeta;
  private count = 0;
  constructor(
    private dir: string,
    pack: PackInfo,
  ) {
    this.meta = {
      managedBy: "mydraw-packs",
      pack: pack.id,
      source: pack.licenseUrl,
      license: pack.license,
      licenseUrl: pack.licenseUrl,
      items: {},
    };
  }

  add(groups: string[], name: string, svg: Buffer | string, tags: string[] = []): void {
    const segs = groups.map(safeSegment);
    const folder = path.join(this.dir, ...segs);
    fs.mkdirSync(folder, { recursive: true });
    let base = safeSegment(name);
    let file = path.join(folder, `${base}.svg`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(folder, `${base} ${n}.svg`);
    fs.writeFileSync(file, svg);
    if (tags.length) {
      const rel = [...segs, path.basename(file)].join("/");
      this.meta.items![rel] = { tags };
    }
    this.count++;
  }

  finish(): number {
    fs.writeFileSync(path.join(this.dir, "collection.json"), JSON.stringify(this.meta, null, 2));
    return this.count;
  }
}

// ---------- individual packs ----------

/** Short names people search for, keyed by the AWS icon name. */
const AWS_ALIASES: Record<string, string[]> = {
  "Amazon Simple Storage Service": ["s3", "bucket", "object storage"],
  "Amazon Simple Queue Service": ["sqs", "queue"],
  "Amazon Simple Notification Service": ["sns", "notification", "pubsub"],
  "Elastic Load Balancing": ["elb", "alb", "nlb", "lb", "load balancer"],
  "Amazon Virtual Private Cloud": ["vpc", "network"],
  "Amazon Elastic Kubernetes Service": ["eks", "kubernetes", "k8s"],
  "Amazon Elastic Container Service": ["ecs", "containers"],
  "Amazon Elastic Container Registry": ["ecr", "registry"],
  "Amazon Elastic Block Store": ["ebs", "volume", "disk"],
  "Amazon Elastic File System": ["efs", "nfs"],
  "AWS Identity and Access Management": ["iam"],
  "Amazon CloudFront": ["cdn"],
  "Amazon Route 53": ["dns", "route53"],
  "AWS Key Management Service": ["kms", "keys"],
  "AWS WAF": ["waf", "firewall"],
  "AWS Network Firewall": ["firewall"],
  "Amazon DynamoDB": ["dynamo", "nosql"],
  "Amazon ElastiCache": ["redis", "memcached", "cache"],
  "AWS Direct Connect": ["dx", "interconnect"],
  "AWS Transit Gateway": ["tgw"],
  "AWS Site-to-Site VPN": ["vpn"],
  "AWS Client VPN": ["vpn"],
  "Amazon API Gateway": ["api", "apigw"],
  "AWS Certificate Manager": ["acm", "tls", "ssl"],
  "AWS Secrets Manager": ["secrets"],
  "Amazon CloudWatch": ["monitoring", "logs", "metrics"],
};

async function buildAws(w: PackWriter, tmp: string, log: Progress): Promise<void> {
  const url = await findZip(
    "https://aws.amazon.com/architecture/icons/",
    /https:\/\/[^"'\s<>]+\/Icon-package_[^"'\s<>]+\.zip/,
  );
  log("Downloading AWS icons…");
  await download(url, path.join(tmp, "aws.zip"));
  unzip(path.join(tmp, "aws.zip"), path.join(tmp, "aws"));
  const clean = (base: string) =>
    words(
      base
        .replace(/^(Arch-Category|Arch|Res)_/, "")
        .replace(/_(16|32|48|64)(_(Light|Dark))?$/, "")
        .replace(/_/g, " - "),
    ).replace(/ - /g, " ");
  for (const f of walk(path.join(tmp, "aws"))) {
    if (!f.endsWith(".svg") || /_Dark\.svg$/.test(f)) continue;
    const rel = path.relative(path.join(tmp, "aws"), f).split(path.sep);
    const top = rel[0] ?? "";
    const base = path.basename(f, ".svg");
    if (top.startsWith("Architecture-Service-Icons")) {
      // Architecture-Service-Icons_x/Arch_<Category>/64/Arch_<Name>_64.svg
      if (rel[2] !== "64") continue;
      const category = words(rel[1].replace(/^Arch_/, ""));
      const name = clean(base);
      w.add(["Services", category], name, fs.readFileSync(f), ["service", "aws", ...(AWS_ALIASES[name] ?? [])]);
    } else if (top.startsWith("Resource-Icons")) {
      const category = words((rel[1] ?? "").replace(/^Res_/, ""));
      w.add(["Resources", category], clean(base), fs.readFileSync(f), ["resource", "aws"]);
    } else if (top.startsWith("Architecture-Group-Icons")) {
      w.add(["Groups"], clean(base), fs.readFileSync(f), ["group", "aws"]);
    } else if (top.startsWith("Category-Icons")) {
      if (!/_64$/.test(base)) continue;
      w.add(["Categories"], clean(base), fs.readFileSync(f), ["category", "aws"]);
    }
  }
}

async function buildAzure(w: PackWriter, tmp: string, log: Progress): Promise<void> {
  const url = await findZip(
    "https://learn.microsoft.com/en-us/azure/architecture/icons/",
    /https:\/\/arch-center\.azureedge\.net\/icons\/[^"'\s<>]+\.zip/,
    "https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V25.zip",
  );
  log("Downloading Azure icons…");
  await download(url, path.join(tmp, "azure.zip"));
  unzip(path.join(tmp, "azure.zip"), path.join(tmp, "azure"));
  for (const f of walk(path.join(tmp, "azure"))) {
    if (!f.endsWith(".svg")) continue;
    const category = titleCase(path.basename(path.dirname(f)));
    const name = words(path.basename(f, ".svg").replace(/^\d+-icon-service-/, ""));
    w.add([category], name, fs.readFileSync(f), ["azure"]);
  }
}

async function buildGcp(w: PackWriter, tmp: string, log: Progress): Promise<void> {
  const page = "https://cloud.google.com/icons";
  const sources: Array<[string, string, string]> = [
    ["Products", "core-products-icons.zip", "https://services.google.com/fh/files/misc/core-products-icons.zip"],
    ["Categories", "category-icons.zip", "https://services.google.com/fh/files/misc/category-icons.zip"],
    ["Services", "google-cloud-legacy-icons.zip", "https://services.google.com/fh/files/misc/google-cloud-legacy-icons.zip"],
  ];
  let html = "";
  try {
    html = await fetchText(page);
  } catch {
    // use fallbacks
  }
  for (const [group, file, fallback] of sources) {
    const m = html.match(new RegExp(`https://[^"'\\s<>]+/${file.replace(/\./g, "\\.")}`));
    log(`Downloading Google Cloud ${group.toLowerCase()} icons…`);
    const zip = path.join(tmp, file);
    await download(m?.[0] ?? fallback, zip);
    const dest = path.join(tmp, path.basename(file, ".zip"));
    unzip(zip, dest);
    for (const f of walk(dest)) {
      if (!f.endsWith(".svg")) continue;
      // Products/Categories: "<Name>/SVG/<file>.svg"; legacy: "<snake_name>/<snake_name>.svg"
      const parent = path.basename(path.dirname(f));
      const nameDir = parent.toUpperCase() === "SVG" ? path.basename(path.dirname(path.dirname(f))) : parent;
      w.add([group], titleCase(nameDir.replace(/ _ /g, " & ")), fs.readFileSync(f), ["gcp", "google cloud"]);
    }
  }
}

const K8S_NAMES: Record<string, string> = {
  "c-role": "ClusterRole", cm: "ConfigMap", crb: "ClusterRoleBinding", crd: "CustomResourceDefinition",
  cronjob: "CronJob", deploy: "Deployment", ds: "DaemonSet", ep: "Endpoints", group: "Group",
  hpa: "HorizontalPodAutoscaler", ing: "Ingress", job: "Job", limits: "LimitRange", netpol: "NetworkPolicy",
  ns: "Namespace", pod: "Pod", psp: "PodSecurityPolicy", pv: "PersistentVolume", pvc: "PersistentVolumeClaim",
  quota: "ResourceQuota", rb: "RoleBinding", role: "Role", rs: "ReplicaSet", sa: "ServiceAccount",
  sc: "StorageClass", secret: "Secret", sts: "StatefulSet", svc: "Service", user: "User", vol: "Volume",
  vpa: "VerticalPodAutoscaler", api: "API Server", "c-c-m": "Cloud Controller Manager",
  "c-m": "Controller Manager", "k-proxy": "Kube Proxy", kubelet: "Kubelet", sched: "Scheduler",
  ca: "Certificate Authority", "control-plane": "Control Plane", etcd: "etcd", node: "Node",
};

async function buildK8s(w: PackWriter, _tmp: string, log: Progress): Promise<void> {
  log("Downloading Kubernetes icons…");
  const repo = await fetchJson<{ default_branch: string }>("https://api.github.com/repos/kubernetes/community");
  const branch = repo.default_branch || "main";
  const tree = await fetchJson<{ tree: Array<{ path: string }> }>(
    `https://api.github.com/repos/kubernetes/community/git/trees/${branch}?recursive=1`,
  );
  const files = tree.tree.map((t) => t.path).filter((p) => /^icons\/svg\/[^/]+\/unlabeled\/[^/]+\.svg$/.test(p));
  const groupNames: Record<string, string> = {
    resources: "Resources",
    control_plane_components: "Control Plane",
    infrastructure_components: "Infrastructure",
  };
  for (const p of files) {
    const [, , group, , file] = p.split("/");
    const abbr = path.basename(file, ".svg");
    const svg = await fetchText(`https://raw.githubusercontent.com/kubernetes/community/${branch}/${p}`);
    w.add([groupNames[group] ?? titleCase(group)], K8S_NAMES[abbr] ?? titleCase(abbr), svg, ["kubernetes", "k8s", abbr]);
  }
}

interface IconifySet {
  width?: number;
  height?: number;
  icons: Record<string, { body: string; width?: number; height?: number }>;
}

async function fetchIconify(name: string, tmp: string): Promise<IconifySet> {
  const meta = await fetchJson<{ "dist-tags": { latest: string }; versions: Record<string, { dist: { tarball: string } }> }>(
    `https://registry.npmjs.org/@iconify-json/${name}`,
  );
  const tarball = meta.versions[meta["dist-tags"].latest].dist.tarball;
  const tgz = path.join(tmp, `${name}.tgz`);
  await download(tarball, tgz);
  const dest = path.join(tmp, name);
  fs.mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-xzf", tgz, "-C", dest, "package/icons.json"], { stdio: "ignore" });
  return JSON.parse(fs.readFileSync(path.join(dest, "package", "icons.json"), "utf8")) as IconifySet;
}

function iconifySvg(set: IconifySet, name: string, color?: string): string | null {
  const icon = set.icons[name];
  if (!icon) return null;
  const w = icon.width ?? set.width ?? 16;
  const h = icon.height ?? set.height ?? 16;
  const style = color ? ` style="color:${color}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 2}" height="${h * 2}"${style}>${icon.body}</svg>`;
}

/** Curated network/infrastructure icons from IBM Carbon: [icon, name, group, tags]. */
const NETWORK_ICONS: Array<[string, string, string, string[]]> = [
  ["router", "Router", "Devices", ["router"]],
  ["router-wifi", "Wireless Router", "Devices", ["wifi", "router"]],
  ["router-voice", "Voice Router", "Devices", ["voip"]],
  ["switch-layer-2", "Switch (L2)", "Devices", ["switch", "layer 2"]],
  ["switch-layer-3", "Switch (L3)", "Devices", ["switch", "layer 3", "router"]],
  ["firewall", "Firewall", "Security", ["firewall"]],
  ["firewall-classic", "Firewall (Classic)", "Security", ["firewall"]],
  ["intrusion-prevention", "Intrusion Prevention (IPS)", "Security", ["ips", "ids"]],
  ["security", "Security", "Security", ["shield"]],
  ["gateway-security", "Security Gateway", "Security", ["gateway"]],
  ["subnet-acl-rules", "Subnet ACL", "Security", ["acl", "subnet"]],
  ["load-balancer-application", "Load Balancer (Application)", "Load Balancing", ["lb", "alb", "l7"]],
  ["load-balancer-network", "Load Balancer (Network)", "Load Balancing", ["lb", "nlb", "l4"]],
  ["load-balancer-global", "Load Balancer (Global)", "Load Balancing", ["lb", "gslb"]],
  ["load-balancer-classic", "Load Balancer (Classic)", "Load Balancing", ["lb"]],
  ["load-balancer-vpc", "Load Balancer (VPC)", "Load Balancing", ["lb"]],
  ["load-balancer-pool", "Load Balancer Pool", "Load Balancing", ["lb", "pool"]],
  ["load-balancer-listener", "Load Balancer Listener", "Load Balancing", ["lb", "listener"]],
  ["gateway", "Gateway", "Connectivity", ["gateway"]],
  ["gateway-vpn", "VPN Gateway", "Connectivity", ["vpn", "gateway"]],
  ["gateway-public", "Public Gateway", "Connectivity", ["nat", "gateway", "internet"]],
  ["vpn", "VPN", "Connectivity", ["vpn", "tunnel"]],
  ["vpn-connection", "VPN Connection", "Connectivity", ["vpn", "tunnel"]],
  ["direct-link", "Direct Link", "Connectivity", ["interconnect", "direct connect"]],
  ["hybrid-networking", "Hybrid Networking", "Connectivity", ["hybrid"]],
  ["vlan", "VLAN", "Networks", ["vlan"]],
  ["virtual-private-cloud", "VPC", "Networks", ["vpc", "virtual network"]],
  ["network-public", "Public Network", "Networks", ["internet", "wan"]],
  ["network-enterprise", "Enterprise Network", "Networks", ["lan"]],
  ["network-overlay", "Overlay Network", "Networks", ["overlay", "sdn"]],
  ["network-interface", "Network Interface", "Networks", ["nic", "interface"]],
  ["network-1", "Network", "Networks", ["topology"]],
  ["network-2", "Network (Mesh)", "Networks", ["topology", "mesh"]],
  ["network-3", "Network (Hub)", "Networks", ["topology", "hub"]],
  ["network-4", "Network (Star)", "Networks", ["topology", "star"]],
  ["ip", "IP Address", "Networks", ["ip", "address"]],
  ["floating-ip", "Floating IP", "Networks", ["ip", "elastic ip"]],
  ["dns-services", "DNS", "Services", ["dns"]],
  ["server-dns", "DNS Server", "Services", ["dns", "server"]],
  ["server-proxy", "Proxy Server", "Services", ["proxy", "server"]],
  ["server-time", "NTP Server", "Services", ["ntp", "time", "server"]],
  ["bare-metal-server", "Server", "Compute", ["server", "host", "bare metal"]],
  ["virtual-machine", "Virtual Machine", "Compute", ["vm", "server"]],
  ["edge-node", "Edge Node", "Compute", ["edge"]],
  ["edge-device", "Edge Device", "Compute", ["edge", "iot"]],
  ["data-base", "Database", "Storage", ["database", "db", "sql"]],
  ["object-storage", "Object Storage", "Storage", ["s3", "bucket", "storage"]],
  ["block-storage", "Block Storage", "Storage", ["disk", "volume", "san"]],
  ["wifi", "Wi-Fi", "Wireless", ["wifi", "wireless", "access point", "ap"]],
  ["wifi-controller", "Wi-Fi Controller", "Wireless", ["wifi", "controller", "wlc"]],
  ["wifi-bridge", "Wi-Fi Bridge", "Wireless", ["wifi", "bridge", "ptp"]],
  ["wifi-secure", "Secure Wi-Fi", "Wireless", ["wifi", "wpa"]],
  ["cell-tower", "Cell Tower", "Wireless", ["lte", "5g", "cellular"]],
  ["satellite", "Satellite", "Wireless", ["satellite", "starlink"]],
  ["cloud", "Cloud", "Endpoints", ["cloud", "internet"]],
  ["cloud-services", "Cloud Services", "Endpoints", ["cloud"]],
  ["laptop", "Laptop", "Endpoints", ["client", "computer"]],
  ["mobile", "Mobile Phone", "Endpoints", ["phone", "client"]],
  ["phone-ip", "IP Phone", "Endpoints", ["voip", "phone"]],
  ["printer", "Printer", "Endpoints", ["printer"]],
  ["camera", "Camera", "Endpoints", ["cctv", "nvr"]],
  ["sensor", "Sensor", "Endpoints", ["iot"]],
  ["iot-platform", "IoT Platform", "Endpoints", ["iot"]],
  ["user", "User", "People & Places", ["person", "client"]],
  ["group", "Users", "People & Places", ["people", "team"]],
  ["building", "Building", "People & Places", ["site", "office", "datacenter"]],
  ["enterprise", "Office", "People & Places", ["site", "headquarters"]],
];

async function buildNetwork(w: PackWriter, tmp: string, log: Progress): Promise<void> {
  log("Downloading network icons…");
  const set = await fetchIconify("carbon", tmp);
  for (const [icon, name, group, tags] of NETWORK_ICONS) {
    const svg = iconifySvg(set, icon, "#1e1e1e");
    if (svg) w.add([group], name, svg, ["network", ...tags]);
  }
}

async function buildLogos(w: PackWriter, tmp: string, log: Progress): Promise<void> {
  log("Downloading product logos…");
  const set = await fetchIconify("logos", tmp);
  for (const name of Object.keys(set.icons)) {
    const svg = iconifySvg(set, name);
    if (!svg) continue;
    // "-icon" variants are the square symbol of the same brand.
    const isSymbol = name.endsWith("-icon");
    const title = titleCase(isSymbol ? name.replace(/-icon$/, "") : name) + (isSymbol ? " (symbol)" : "");
    w.add([title[0].match(/[a-z]/i) ? title[0].toUpperCase() : "#"], title, svg, ["logo", name]);
  }
}

const BUILDERS: Record<string, (w: PackWriter, tmp: string, log: Progress) => Promise<void>> = {
  aws: buildAws,
  azure: buildAzure,
  gcp: buildGcp,
  k8s: buildK8s,
  network: buildNetwork,
  logos: buildLogos,
};

/** Is `collection` in `root` managed by the downloader (or absent)? User folders are never overwritten. */
function canReplace(root: string, collection: string): boolean {
  const dir = path.join(root, collection);
  if (!fs.existsSync(dir)) return true;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "collection.json"), "utf8")) as CollectionMeta;
    return meta.managedBy === "mydraw-packs";
  } catch {
    return false;
  }
}

export interface InstallResult {
  pack: string;
  ok: boolean;
  count?: number;
  error?: string;
}

/** Install (or update) packs into `root`. Each pack is built in a temp folder and swapped in when complete. */
export async function installPacks(root: string, ids: string[], log: Progress = () => {}): Promise<InstallResult[]> {
  const results: InstallResult[] = [];
  for (const id of ids) {
    const pack = PACKS.find((p) => p.id === id);
    const build = BUILDERS[id];
    if (!pack || !build) {
      results.push({ pack: id, ok: false, error: "unknown pack" });
      continue;
    }
    if (!canReplace(root, pack.collection)) {
      results.push({ pack: id, ok: false, error: `"${pack.collection}" exists and was not created by mydraw; rename it first` });
      continue;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `mydraw-pack-${id}-`));
    const staging = path.join(root, `.${pack.collection}.installing`);
    try {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      const writer = new PackWriter(staging, pack);
      await build(writer, tmp, log);
      const count = writer.finish();
      if (!count) throw new Error("no icons found in the download");
      const final = path.join(root, pack.collection);
      fs.rmSync(final, { recursive: true, force: true });
      fs.renameSync(staging, final);
      log(`${pack.title}: ${count} icons installed`);
      results.push({ pack: id, ok: true, count });
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true });
      log(`${pack.title}: failed (${(e as Error).message})`);
      results.push({ pack: id, ok: false, error: (e as Error).message });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  writeLicenses(root);
  return results;
}

function writeLicenses(root: string): void {
  const lines = ["# Icon pack licenses", "", "Downloaded by mydraw for personal diagramming use. Do not redistribute the packs.", ""];
  for (const p of PACKS) {
    if (fs.existsSync(path.join(root, p.collection, "collection.json"))) {
      lines.push(`## ${p.title} (${p.collection}/)`, "", `- License: ${p.license}`, `- Source: ${p.licenseUrl}`, "");
    }
  }
  fs.writeFileSync(path.join(root, "LICENSES.md"), lines.join("\n"));
}

/** Which packs are installed (by collection.json pack id). */
export function installedPacks(root: string): string[] {
  return PACKS.filter((p) => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(root, p.collection, "collection.json"), "utf8")) as CollectionMeta;
      return meta.managedBy === "mydraw-packs" && meta.pack === p.id;
    } catch {
      return false;
    }
  }).map((p) => p.id);
}
