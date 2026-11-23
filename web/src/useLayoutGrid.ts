// Per-tab controller for the layout grid:
//  - paints the grid inside Excalidraw's static canvas, behind the shapes (gridHook.ts);
//  - drives Excalidraw's grid mode for live snapping (its own grid lines are hidden by the hook);
//  - health-checks the hook after each grid change and falls back to the overlay canvas
//    (GridOverlay.tsx) without live snapping when an Excalidraw upgrade broke it.
// See EXCALIDRAW-UPGRADE.md.
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { excalidrawGridState, type GridSettings } from "../../shared/grid";
import { GridHook, type GridHookStatus } from "./gridHook";

export type GridMode = "checking" | "in-canvas" | "overlay";

export interface GridHealth {
  mode: GridMode;
  /** Live snapping works (Excalidraw grid mode can be used and its grid lines are hidden). */
  snapOk: boolean;
}

/** Status per tab, for the smoke test (`__mydrawTest.gridStatus`). */
export const gridStatusByTab = new Map<string, () => GridHookStatus & GridHealth>();

/** How long to wait for Excalidraw to re-render after a grid change before judging the hook. */
const CHECK_DELAY_MS = 150;

interface Options {
  tabId: string;
  grid: GridSettings;
  hidden: boolean;
  theme: "light" | "dark";
  apiRef: { current: ExcalidrawImperativeAPI | null };
  rootRef: { current: HTMLElement | null };
  /** Excalidraw's own "Toggle grid" (context menu etc.) was used: toggle ours instead. */
  onExternalToggle(): void;
  onHealth(h: GridHealth): void;
}

export function useLayoutGrid({ tabId, grid, hidden, theme, apiRef, rootRef, onExternalToggle, onHealth }: Options) {
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const [health, setHealth] = useState<GridHealth>({ mode: "checking", snapOk: true });
  const healthRef = useRef(health);
  healthRef.current = health;
  const onHealthRef = useRef(onHealth);
  onHealthRef.current = onHealth;
  const onToggleRef = useRef(onExternalToggle);
  onToggleRef.current = onExternalToggle;
  /** Grid state we last gave Excalidraw (null until the first change after load). */
  const applied = useRef<{ gridModeEnabled: boolean; gridSize: number } | null>(null);
  const stepFlip = useRef(false);
  /** Failed checks in a row (one retry before falling back, e.g. while the app is still starting). */
  const misses = useRef(0);
  const [retry, setRetry] = useState(0);

  const hook = useMemo(
    () => new GridHook(() => apiRef.current, () => gridRef.current, () => healthRef.current.mode !== "overlay"),
    [apiRef],
  );
  useEffect(() => () => hook.detach(), [hook]);

  useEffect(() => {
    gridStatusByTab.set(tabId, () => ({ ...hook.status(), ...healthRef.current }));
    return () => void gridStatusByTab.delete(tabId);
  }, [tabId, hook]);

  const setHealthBoth = useCallback((h: GridHealth) => {
    healthRef.current = h;
    setHealth(h);
    onHealthRef.current(h);
  }, []);

  /** Give Excalidraw the grid state we want (no undo entry). `force` also makes the static canvas re-render. */
  const apply = useCallback((force: boolean) => {
    const api = apiRef.current;
    if (!api) return;
    const want = excalidrawGridState(gridRef.current, healthRef.current.snapOk && healthRef.current.mode !== "overlay");
    const st = api.getAppState();
    const same = st.gridModeEnabled === want.gridModeEnabled && st.gridSize === want.gridSize;
    applied.current = want;
    if (same && !force) return;
    // gridStep only changes how Excalidraw's (hidden) grid draws, and it is one of the props that
    // re-render the static canvas, so flipping it forces a repaint of our grid.
    stepFlip.current = !stepFlip.current;
    api.updateScene({
      appState: { ...want, ...(force ? { gridStep: stepFlip.current ? 2 : 3 } : {}) } as Pick<AppState, "gridModeEnabled" | "gridSize">,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [apiRef]);

  /** Called from Excalidraw's onChange. */
  const onSceneChange = useCallback(
    (appState: AppState) => {
      hook.attach(rootRef.current);
      const a = applied.current;
      if (a && appState.gridModeEnabled !== a.gridModeEnabled) {
        // Someone flipped Excalidraw's grid (its context menu "Toggle grid"): treat it as toggling ours.
        applied.current = { ...a, gridModeEnabled: appState.gridModeEnabled };
        onToggleRef.current();
        return;
      }
      if (!a || appState.gridSize !== a.gridSize) apply(false);
    },
    [hook, rootRef, apply],
  );

  // After every grid/theme change on the visible tab: repaint and check that the hook still works.
  const key = `${JSON.stringify(grid)}|${theme}`;
  useEffect(() => {
    if (hidden) return;
    const api = apiRef.current;
    if (!api) return;
    hook.attach(rootRef.current);
    if (!grid.enabled) {
      apply(true); // repaint without the grid, grid mode off
      return;
    }
    const before = hook.settle();
    apply(true);
    const t = window.setTimeout(() => {
      hook.attach(rootRef.current);
      const after = hook.settle();
      const prev = healthRef.current;
      let next: GridHealth = prev;
      if (after.renders === before.renders) {
        // The forced render never reached our hook: Excalidraw's renderer changed (assumption 1).
        if (++misses.current < 2) return setRetry((n) => n + 1);
        next = { mode: "overlay", snapOk: false };
        console.warn("mydraw: grid hook did not see a render; using the overlay grid without live snapping. See EXCALIDRAW-UPGRADE.md.");
      } else {
        misses.current = 0;
        const gridModeOn = after.gridModeRenders > before.gridModeRenders;
        const hidOwnGrid = after.gridModeRendersSuppressed > before.gridModeRendersSuppressed;
        const snapOk = gridModeOn && !hidOwnGrid ? false : prev.snapOk;
        if (!snapOk && prev.snapOk) {
          console.warn("mydraw: could not hide Excalidraw's own grid lines; live snapping is off. See EXCALIDRAW-UPGRADE.md.");
        }
        next = { mode: "in-canvas", snapOk };
      }
      if (next.mode !== prev.mode || next.snapOk !== prev.snapOk) {
        setHealthBoth(next);
        apply(true); // grid mode off if snapping was dropped; repaint (or stop painting) in the canvas
      } else if (prev.mode === "checking") {
        setHealthBoth(next);
      }
    }, CHECK_DELAY_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hidden, hook, apply, retry]);

  return { health, onSceneChange, overlay: grid.enabled && health.mode === "overlay" };
}
