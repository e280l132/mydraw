// Installs the dash-pattern hook the patched Excalidraw generator options call
// (scripts/excalidrawPatch.mjs, `patchDash`): extra stroke styles from customData.mydrawDash
// (shared/dash.ts). Returns undefined for every other element, so Excalidraw's own dash is kept.
import { dashArrayFor } from "../../shared/dash";

declare global {
  // eslint-disable-next-line no-var
  var __mydrawDash: ((el: { strokeStyle?: string; strokeWidth?: number; customData?: Record<string, unknown> | null }) => number[] | undefined) | undefined;
}

globalThis.__mydrawDash = dashArrayFor;
