// Per-node properties (hostname, IP, VLAN, role, owner, URL, notes) stored in an element's
// customData next to the mydraw* markers. Pure. Reading is alias tolerant (a build_diagram `data`
// of {address: "10.0.0.1"} counts as the IP); writing normalises to the canonical key.

export const PROPERTY_FIELDS = [
  { key: "hostname", label: "Hostname", aliases: ["hostname", "host", "fqdn", "dns"] },
  { key: "ip", label: "IP address", aliases: ["ip", "ipaddress", "ip_address", "address", "addr"] },
  { key: "vlan", label: "VLAN", aliases: ["vlan", "vlan_id", "vlanid"] },
  { key: "role", label: "Role", aliases: ["role", "function"] },
  { key: "owner", label: "Owner", aliases: ["owner", "team"] },
  { key: "url", label: "URL", aliases: ["url", "uri", "href"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "description", "comment", "comments"], multiline: true },
] as const;

export type PropertyKey = (typeof PROPERTY_FIELDS)[number]["key"];
export const PROPERTY_KEYS: readonly PropertyKey[] = PROPERTY_FIELDS.map((f) => f.key);

const fieldFor = (key: string) => PROPERTY_FIELDS.find((f) => (f.aliases as readonly string[]).includes(key.toLowerCase()));

/** Value of one property in a flat record, matching aliases ("" when absent). */
export function propertyOf(data: Record<string, unknown> | undefined | null, key: PropertyKey): string {
  const field = PROPERTY_FIELDS.find((f) => f.key === key)!;
  for (const [k, v] of Object.entries(data ?? {})) {
    if ((field.aliases as readonly string[]).includes(k.toLowerCase()) && v !== undefined && v !== null) return String(v);
  }
  return "";
}

/** The user-visible properties (all known keys) of an element's customData. */
export function readProperties(customData: Record<string, unknown> | undefined | null): Record<PropertyKey, string> {
  return Object.fromEntries(PROPERTY_FIELDS.map((f) => [f.key, propertyOf(customData, f.key)])) as Record<PropertyKey, string>;
}

/** Other user keys (not mydraw*, not one of the known properties). */
export function extraProperties(customData: Record<string, unknown> | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(customData ?? {})) {
    if (k.startsWith("mydraw") || fieldFor(k) || v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

/**
 * customData with `patch` applied: a string sets (canonical key, aliases removed), "" or null removes.
 * Keys that are not known properties are set as given. Returns undefined when nothing is left.
 */
export function applyProperties(
  customData: Record<string, unknown> | undefined | null,
  patch: Record<string, string | null>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = { ...(customData ?? {}) };
  for (const [rawKey, value] of Object.entries(patch)) {
    if (rawKey.startsWith("mydraw")) throw new Error(`"${rawKey}" is reserved`);
    const field = fieldFor(rawKey);
    if (field) {
      for (const k of Object.keys(out)) if ((field.aliases as readonly string[]).includes(k.toLowerCase())) delete out[k];
    } else {
      delete out[rawKey];
    }
    const key = field ? field.key : rawKey;
    const text = value === null ? "" : String(value).trim();
    if (text) out[key] = text;
    else delete out[key];
  }
  return Object.keys(out).length ? out : undefined;
}
