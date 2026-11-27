import { describe, expect, it } from "vitest";
import { inferRole, NODE_ROLES, ROLE_STYLES } from "../shared/nodeRoles";
import { resolveColor } from "../shared/palettes";
import { normalizeSpec } from "../shared/diagram";

describe("inferRole", () => {
  it("an explicit role wins", () => {
    expect(inferRole({ role: "security", label: "postgres" })).toBe("security");
  });
  it("ignores an unknown role and guesses", () => {
    expect(inferRole({ role: "nonsense", label: "Postgres primary" })).toBe("data");
  });
  it("reads shapes", () => {
    expect(inferRole({ shape: "cylinder", label: "x" })).toBe("data");
    expect(inferRole({ shape: "queue" })).toBe("queue");
    expect(inferRole({ shape: "actor" })).toBe("entry");
    expect(inferRole({ shape: "cloud" })).toBe("external");
  });
  it("reads kind, icon and label words", () => {
    expect(inferRole({ label: "Redis cache" })).toBe("data");
    expect(inferRole({ label: "Kafka" })).toBe("queue");
    expect(inferRole({ label: "nginx" })).toBe("edge");
    expect(inferRole({ label: "Load balancer" })).toBe("edge");
    expect(inferRole({ label: "Users" })).toBe("entry");
    expect(inferRole({ icon: "AWS:Amazon S3" })).toBe("storage");
    expect(inferRole({ label: "Grafana" })).toBe("monitoring");
    expect(inferRole({ label: "pfSense firewall" })).toBe("security");
    expect(inferRole({ label: "web-1", kind: "Server" })).toBe("compute");
    expect(inferRole({ label: "Stripe API" })).toBe("external");
  });
  it("defaults to service", () => {
    expect(inferRole({ label: "Checkout" })).toBe("service");
    expect(inferRole({})).toBe("service");
  });
});

describe("ROLE_STYLES", () => {
  it("every role has a pale fill and a deeper stroke from the ramp palette", () => {
    for (const r of NODE_ROLES) {
      const s = ROLE_STYLES[r];
      expect(s.fill).toBe(resolveColor(`${s.hue}-50`));
      expect(s.stroke).toBe(resolveColor(`${s.hue}-700`));
      expect(s.title).toBeTruthy();
    }
    expect(ROLE_STYLES.external.strokeStyle).toBe("dashed");
  });
  it("roles are distinct hues", () => {
    expect(new Set(NODE_ROLES.map((r) => ROLE_STYLES[r].hue)).size).toBe(NODE_ROLES.length);
  });
});

describe("spec", () => {
  it("accepts role and the polished look, refuses unknown roles", () => {
    const s = normalizeSpec({ look: "polished", nodes: [{ id: "a", role: "data" }] });
    expect(s.nodes[0].role).toBe("data");
    expect(s.look).toBe("polished");
    expect(() => normalizeSpec({ nodes: [{ id: "a", role: "db" }] })).toThrow(/role/);
  });
});
