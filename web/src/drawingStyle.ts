import { FONT_FAMILY } from "@excalidraw/excalidraw";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { DrawingStyle } from "../../shared/types";
import { fontIdByName } from "./fontRegistry";

/**
 * Default tool settings for new elements. These are user preferences, not part of the
 * document, so they are applied to every tab (new and opened) and never change existing shapes.
 * Clean writes new text in Inter (one of mydraw's extra fonts, web/src/fontRegistry.tsx), or
 * Nunito when the extra fonts are off.
 */
export function drawingStyleAppState(style: DrawingStyle): Partial<AppState> {
  if (style === "sketch") {
    return {
      currentItemRoughness: 1,
      currentItemRoundness: "round",
      currentItemFontFamily: FONT_FAMILY.Excalifont,
      currentItemStrokeWidth: 2,
    };
  }
  return {
    currentItemRoughness: 0,
    currentItemRoundness: "sharp",
    currentItemFontFamily: (fontIdByName("Inter") ?? FONT_FAMILY.Nunito) as AppState["currentItemFontFamily"],
    currentItemStrokeWidth: 2,
  };
}
