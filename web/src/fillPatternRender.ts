// Installs the fill-pattern hook the patched Excalidraw generator options call
// (scripts/excalidrawPatch.mjs, `patchFillPattern`): hatch line width and spacing from
// customData.mydrawFillPattern (shared/fillPattern.ts). Undefined for everything else.
import { fillPatternFor } from "../../shared/fillPattern";

declare global {
  // eslint-disable-next-line no-var
  var __mydrawFillPattern: typeof fillPatternFor | undefined;
}

globalThis.__mydrawFillPattern = fillPatternFor;
