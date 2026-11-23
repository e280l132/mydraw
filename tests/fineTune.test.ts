import { describe, expect, it } from "vitest";
import {
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
