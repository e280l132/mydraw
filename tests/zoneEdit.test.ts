import { describe, expect, it } from "vitest";
import { UNLOCKED_KEY, zonesToRelock, zoneTitleAt } from "../shared/zoneEdit";

const zone = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, type: "rectangle", x, y, width: 400, height: 300, locked: true, customData: { mydrawZone: true, ...extra } });
const title = (zoneId: string, x: number, y: number, locked = true) => ({ id: `${zoneId}.title`, type: "text", x, y, width: 100, height: 20, locked, customData: { mydrawZoneTitle: zoneId } });

describe("zone title clicks", () => {
  const els = [zone("vpc", 0, 0), title("vpc", 10, 10), zone("sub", 20, 40), title("sub", 30, 50)];
  it("finds the zone whose title is under the pointer", () => {
    expect(zoneTitleAt(els, 50, 20)?.zone.id).toBe("vpc");
    expect(zoneTitleAt(els, 50, 60)?.zone.id).toBe("sub");
  });
  it("ignores clicks off titles and unlocked titles", () => {
    expect(zoneTitleAt(els, 200, 200)).toBeNull();
    expect(zoneTitleAt([zone("vpc", 0, 0), title("vpc", 10, 10, false)], 50, 20)).toBeNull();
  });
});

describe("relocking", () => {
  const open = [zone("vpc", 0, 0, { [UNLOCKED_KEY]: true }), title("vpc", 10, 10, false), zone("other", 500, 0)];
  it("keeps a selected or renamed zone unlocked", () => {
    expect(zonesToRelock(open, new Set(["vpc"]), null)).toEqual([]);
    expect(zonesToRelock(open, new Set(), "vpc.title")).toEqual([]);
  });
  it("locks it again when the selection moves on, with its title; never other zones", () => {
    expect(zonesToRelock(open, new Set(["something"]), null)).toEqual(["vpc", "vpc.title"]);
  });
});
