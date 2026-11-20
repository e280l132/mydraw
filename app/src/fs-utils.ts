import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Write via a temp file + rename so a crash never leaves a half-written file. */
export function writeFileAtomic(filePath: string, data: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

export function hashContent(data: string | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}
