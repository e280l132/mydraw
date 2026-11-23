import { describe, expect, it } from "vitest";
import {
  anchorAfterResize,
  canTune,
  cleanValue,
  DEFAULT_RADIUS,
  drawnRadius,
  FINE_TUNE,
  isCustom,
  patchFor,
  radiusMax,
  selectionValue,
  SLIDER_STEPS,
  sliderToValue,
  valueToSlider,
  type TunableElement,
} from "../shared/fineTune";

const el = (o: Partial<TunableElement> = {}): TunableElement => ({ type: "rectangle", width: 200, height: 100, strokeWidth: 2, roughness: 1, roundness: null, ...o });

describe("fine-tune sliders", () => {
  it("slider maps both ends and round-trips", () => {
    const { min, max, step } = FINE_TUNE.strokeWidth;
    expect(sliderToValue(0, min, max, step)).toBe(0.5);
    expect(sliderToValue(SLIDER_STEPS, min, max, step)).toBe(32);
    for (const v of [0.5, 1, 2, 4, 8, 16, 32]) expect(sliderToValue(valueToSlider(v, min, max), min, max, step)).toBe(v);
    // Small values get most of the travel: half way is well below the middle of the range.
    expect(sliderToValue(SLIDER_STEPS / 2, min, max, step)).toBeLessThan(10);
  });

  it("roughness reaches 10 in 0.25 steps", () => {
    const { min, max, step } = FINE_TUNE.roughness;
    expect(sliderToValue(SLIDER_STEPS, min, max, step)).toBe(10);
    expect(sliderToValue(valueToSlider(2.25, min, max), min, max, step)).toBe(2.25);
  });

  it("cleans typed values", () => {
    expect(cleanValue(NaN, 0, 10, 0.25)).toBeNull();
    expect(cleanValue(3.13, 0, 10, 0.25)).toBe(3.25);
    expect(cleanValue(99, 0, 10, 0.25)).toBe(10);
    expect(cleanValue(-1, 0.5, 32, 0.5)).toBe(0.5);
  });

  it("knows which elements each slider changes", () => {
    expect(canTune("radius", el())).toBe(true);
    expect(canTune("radius", el({ type: "diamond" }))).toBe(false); // proportional radius only
    expect(canTune("radius", el({ type: "image" }))).toBe(true);
    expect(canTune("roughness", el({ type: "image" }))).toBe(false);
    expect(canTune("strokeWidth", el({ type: "text" }))).toBe(false);
    expect(canTune("strokeWidth", el({ type: "freedraw" }))).toBe(true);
    expect(canTune("strokeWidth", el({ customData: { mydrawNode: "icon" } }))).toBe(false);
  });

  it("radius: cap is a quarter of the shorter side", () => {
    expect(radiusMax([el({ width: 200, height: 100 }), el({ width: 40, height: 400 })])).toBe(25);
    expect(radiusMax([el({ width: 10, height: 10 })])).toBe(8);
    expect(drawnRadius(el({ roundness: { type: 3, value: 80 } }))).toBe(25);
    expect(drawnRadius(el({ roundness: { type: 3 } }))).toBe(25);
    expect(drawnRadius(el({ width: 400, height: 400, roundness: { type: 3 } }))).toBe(DEFAULT_RADIUS);
    expect(drawnRadius(el())).toBe(0);
  });

  it("reads selection values and custom state", () => {
    expect(selectionValue("strokeWidth", [el(), el({ strokeWidth: 6 })])).toEqual({ value: 2, mixed: true });
    expect(selectionValue("roughness", [])).toBeNull();
    expect(isCustom("strokeWidth", [el({ strokeWidth: 4 })])).toBe(false);
    expect(isCustom("strokeWidth", [el({ strokeWidth: 7.5 })])).toBe(true);
    expect(isCustom("radius", [el({ roundness: { type: 3 } })])).toBe(false);
    expect(isCustom("radius", [el({ roundness: { type: 3, value: 12 } })])).toBe(true);
  });

  it("patches", () => {
    expect(patchFor("strokeWidth", 12)).toEqual({ strokeWidth: 12 });
    expect(patchFor("roughness", 6.5)).toEqual({ roughness: 6.5 });
    expect(patchFor("radius", 0)).toEqual({ roundness: null });
    expect(patchFor("radius", 18)).toEqual({ roundness: { type: 3, value: 18 } });
  });
});

describe("font size slider", () => {
  const text = (o: Partial<TunableElement> = {}): TunableElement => ({ type: "text", width: 100, height: 25, strokeWidth: 1, roughness: 0, roundness: null, fontSize: 20, ...o });

  it("covers 4-300 px in whole pixels and keeps small sizes precise", () => {
    const { min, max, step } = FINE_TUNE.fontSize;
    expect([min, max, step]).toEqual([4, 300, 1]);
    expect(sliderToValue(0, min, max, step)).toBe(4);
    expect(sliderToValue(SLIDER_STEPS, min, max, step)).toBe(300);
    for (const v of [4, 12, 16, 20, 28, 36, 72, 144, 300]) expect(sliderToValue(valueToSlider(v, min, max), min, max, step)).toBe(v);
    expect(cleanValue(17.4, min, max, step)).toBe(17);
    expect(cleanValue(1000, min, max, step)).toBe(300);
    expect(cleanValue(0, min, max, step)).toBe(4);
  });

  it("tunes text only; Excalidraw's S/M/L/XL are the presets", () => {
    expect(canTune("fontSize", text())).toBe(true);
    expect(canTune("fontSize", el())).toBe(false);
    // an icon caption is text too
    expect(canTune("fontSize", text({ customData: {} }))).toBe(true);
    expect(isCustom("fontSize", [text({ fontSize: 28 })])).toBe(false);
    expect(isCustom("fontSize", [text({ fontSize: 48 })])).toBe(true);
    expect(selectionValue("fontSize", [text({ fontSize: 24 }), text({ fontSize: 24 })])).toEqual({ value: 24, mixed: false });
    expect(selectionValue("fontSize", [text({ fontSize: 24 }), text({ fontSize: 36 })])?.mixed).toBe(true);
    expect(patchFor("fontSize", 48)).toEqual({ fontSize: 48 });
  });

  it("anchors free text like Excalidraw's own size buttons", () => {
    const prev = { x: 100, y: 100, width: 100, height: 25, textAlign: "left" };
    const next = { width: 200, height: 50 };
    expect(anchorAfterResize(prev, next)).toEqual({ x: 100, y: 87.5 });
    expect(anchorAfterResize({ ...prev, textAlign: "center" }, next)).toEqual({ x: 50, y: 87.5 });
    expect(anchorAfterResize({ ...prev, textAlign: "right" }, next)).toEqual({ x: 0, y: 87.5 });
    // bound text and fixed-width text stay where they are
    expect(anchorAfterResize(prev, { ...next, containerId: "box" })).toEqual({ x: 100, y: 100 });
    expect(anchorAfterResize(prev, { ...next, autoResize: false })).toEqual({ x: 100, y: 100 });
  });
});

