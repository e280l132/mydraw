// Which icons to keep from the big generic icon sets (pure, unit-tested; used by app/src/packs.ts).

/** One-color line art (Carbon, Material, Tabler, Lucide, Simple Icons) gets this color baked in:
 * near-black vanishes on the dark canvas. A mid blue reads on both. */
export const MONO_ICON_COLOR = "#4589ff";

/** Infrastructure categories for the generic sets, in priority order. Match is on whole name words. */
const CATEGORIES: Array<[string, Set<string>]> = [
  ["Network", new Set(["router", "switch", "firewall", "network", "lan", "wan", "wifi", "ethernet", "vpn", "dns", "antenna", "satellite", "hub", "modem", "ip", "web", "earth", "access", "signal", "bluetooth", "radio", "tower", "gateway", "transit"])],
  ["Servers & Storage", new Set(["server", "nas", "harddisk", "database", "cpu", "memory", "chip", "raspberry", "usb", "disc", "disk", "storage", "tape", "nvme", "ssd", "expansion", "drive", "backup", "motherboard", "pci", "processor", "gpu", "ram", "hdd"])],
  ["Cloud & Containers", new Set(["cloud", "docker", "kubernetes", "container", "cube", "package", "lambda", "function", "api", "webhook", "git", "terminal", "code", "console", "script", "robot", "brain", "cogs", "sync", "cloudy"])],
  ["Security", new Set(["lock", "shield", "key", "fingerprint", "certificate", "security", "incognito", "bug", "password", "eye", "badge", "passkey", "vault", "safe", "alarm"])],
  ["Devices", new Set(["monitor", "desktop", "laptop", "tablet", "cellphone", "phone", "printer", "camera", "cctv", "television", "tv", "speaker", "thermostat", "lightbulb", "plug", "battery", "ups", "solar", "smart", "keyboard", "microphone", "webcam", "scanner", "gamepad", "automation", "outlet"])],
  ["Monitoring", new Set(["chart", "speedometer", "bell", "alert", "pulse", "dashboard", "gauge", "thermometer", "graph", "analytics", "activity", "notification"])],
  ["People & Places", new Set(["account", "user", "users", "group", "office", "domain", "factory", "warehouse", "building", "city", "store", "school", "hospital", "map", "marker", "pin", "location", "briefcase", "team", "person", "people"])],
];

/** Words that mark a variant of another icon; skipped so a set doesn't list every icon five times. */
const VARIANT_WORDS = new Set(["off", "plus", "minus", "remove", "check", "outline", "variant", "multiple", "filled", "lock-open", "cancel", "question", "edit", "settings", "alert-circle", "arrow", "up", "down", "left", "right", "circle", "box", "square", "small", "off-outline", "x"]);

const WORD_SPLIT = /[-_\s]+/;

/** Category for a generic icon name ("server-network"), or null when it is not infrastructure-related or is a variant. */
export function classifyInfraIcon(name: string): string | null {
  const words = name.toLowerCase().split(WORD_SPLIT).filter(Boolean);
  if (!words.length) return null;
  if (words.length > 3) return null; // very specific icons ("server-network-outline-off-..."): skip
  if (words.slice(1).some((w) => VARIANT_WORDS.has(w))) return null;
  for (const [category, set] of CATEGORIES) {
    if (words.some((w) => set.has(w))) return category;
  }
  return null;
}

/** Devicon names look like "docker-original", "docker-plain", "docker-original-wordmark". Keep the colored mark only. */
export function keepDevicon(name: string): boolean {
  if (/-(wordmark|line|plain)(-|$)/.test(name)) return false;
  return name.endsWith("-original") || !/-(original|plain|line|wordmark)/.test(name);
}

export function deviconTitle(name: string): string {
  return name.replace(/-original$/, "");
}

export interface DashboardMeta {
  aliases?: string[];
  categories?: string[];
}

/** Keep a Dashboard Icons SVG: not a dark/light variant duplicate, and not huge (some embed photos). */
export function keepDashboardIcon(file: string, size: number): boolean {
  if (size > 100 * 1024) return false;
  return !/-(dark|light)$/.test(file.replace(/\.svg$/, ""));
}

/** Folder (first category) for a Dashboard Icons entry. */
export function dashboardGroup(meta: DashboardMeta | undefined): string {
  const c = meta?.categories?.[0];
  return c ? c.replace(/[-_]+/g, " ").replace(/\b[a-z]/g, (m) => m.toUpperCase()) : "Other";
}
