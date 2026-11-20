import { FONT_FAMILY } from "@excalidraw/excalidraw";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { DrawingStyle } from "../../shared/types";

/**
 * Default tool settings for new elements. These are user preferences, not part of the
 * document, so they are applied to every tab (new and opened) and never change existing shapes.
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
    currentItemFontFamily: FONT_FAMILY.Nunito,
    currentItemStrokeWidth: 2,
  };
}
