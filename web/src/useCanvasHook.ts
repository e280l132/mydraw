// Per-tab controller for the static-canvas hook (canvasHook.ts):
//  - layout grid painted inside Excalidraw's static canvas, behind the shapes;
//  - Excalidraw's grid mode driven for live snapping (its own grid lines hidden by the hook);
//  - dark mode themed inside the canvas so images keep their exact colours (darkImages.ts);
//  - health check after each grid/theme change, with fallbacks when an Excalidraw upgrade broke
//    the hook: overlay grid (GridOverlay.tsx) without live snapping, and Excalidraw's own CSS dark
//    filter (approximate image colours).
// See EXCALIDRAW-UPGRADE.md.
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { excalidrawGridState, type GridSettings } from "../../shared/grid";
import { CanvasHook, type CanvasHookStatus } from "./canvasHook";

export type CanvasMode = "checking" | "in-canvas" | "overlay";

export interface CanvasHealth {
  /** in-canvas: the hook sees renders. overlay: it doesn't (grid falls back to the overlay canvas). */
  mode: CanvasMode;
  /** Live snapping works (Excalidraw grid mode can be used and its grid lines are hidden). */
  snapOk: boolean;
  /** The dark theme can be applied inside the canvas (exact image colours). */
  themeOk: boolean;
}

/** Status per tab, for the smoke test (`__mydrawTest.canvasStatus`). */
export const canvasStatusByTab = new Map<string, () => CanvasHookStatus & CanvasHealth>();

/** How long to wait for Excalidraw to re-render after a change before judging the hook. */
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
  onHealth(h: CanvasHealth): void;
}

export function useCanvasHook({ tabId, grid, hidden, theme, apiRef, rootRef, onExternalToggle, onHealth }: Options) {
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const [health, setHealth] = useState<CanvasHealth>({ mode: "checking", snapOk: true, themeOk: true });
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
    () =>
      new CanvasHook({
        getApi: () => apiRef.current,
        getGrid: () => gridRef.current,
        paintGrid: () => healthRef.current.mode !== "overlay",
        themeInCanvas: () => healthRef.current.mode !== "overlay" && healthRef.current.themeOk,
      }),
    [apiRef],
  );
  useEffect(() => () => hook.detach(), [hook]);

  useEffect(() => {
    canvasStatusByTab.set(tabId, () => ({ ...hook.status(), ...healthRef.current }));
    return () => void canvasStatusByTab.delete(tabId);
  }, [tabId, hook]);

  const setHealthBoth = useCallback((h: CanvasHealth) => {
    healthRef.current = h;
    setHealth(h);
    onHealthRef.current(h);
  }, []);

  /** Give Excalidraw the grid state we want (no undo entry). `force` also makes the static canvas re-render. */
  const apply = useCallback(
    (force: boolean) => {
      const api = apiRef.current;
      if (!api) return;
      const want = excalidrawGridState(gridRef.current, healthRef.current.snapOk && healthRef.current.mode !== "overlay");
      const st = api.getAppState();
      const same = st.gridModeEnabled === want.gridModeEnabled && st.gridSize === want.gridSize;
      applied.current = want;
      if (same && !force) return;
      // gridStep only changes how Excalidraw's (hidden) grid draws, and it is one of the props that
      // re-render the static canvas, so flipping it forces a repaint.
      stepFlip.current = !stepFlip.current;
      api.updateScene({
        appState: { ...want, ...(force ? { gridStep: stepFlip.current ? 2 : 3 } : {}) } as Pick<AppState, "gridModeEnabled" | "gridSize">,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    [apiRef],
  );

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
    if (!grid.enabled && theme !== "dark") {
      apply(true); // repaint without the grid, grid mode off; nothing to check
      return;
    }
    const before = hook.settle();
    apply(true);
    const t = window.setTimeout(() => {
      hook.attach(rootRef.current);
      const after = hook.settle();
      const prev = healthRef.current;
      let next: CanvasHealth = prev;
      if (after.renders === before.renders) {
        // The forced render never reached our hook: Excalidraw's renderer changed (assumption 1).
        if (++misses.current < 2) return setRetry((n) => n + 1);
        next = { mode: "overlay", snapOk: false, themeOk: false };
        console.warn("mydraw: canvas hook did not see a render; overlay grid, no live snapping, Excalidraw's own dark filter. See EXCALIDRAW-UPGRADE.md.");
      } else {
        misses.current = 0;
        const gridModeOn = after.gridModeRenders > before.gridModeRenders;
        const hidOwnGrid = after.gridModeRendersSuppressed > before.gridModeRendersSuppressed;
        const snapOk = gridModeOn && !hidOwnGrid ? false : prev.snapOk;
        if (!snapOk && prev.snapOk) {
          console.warn("mydraw: could not hide Excalidraw's own grid lines; live snapping is off. See EXCALIDRAW-UPGRADE.md.");
        }
        const themeOk = after.themeLost > before.themeLost ? false : prev.themeOk;
        if (!themeOk && prev.themeOk) {
          console.warn("mydraw: the in-canvas dark theme was lost while drawing; using Excalidraw's own dark filter. See EXCALIDRAW-UPGRADE.md.");
        }
        next = { mode: "in-canvas", snapOk, themeOk };
      }
      if (next.mode !== prev.mode || next.snapOk !== prev.snapOk || next.themeOk !== prev.themeOk) {
        setHealthBoth(next);
        apply(true); // grid mode off if snapping was dropped; repaint with the new mode
      } else if (prev.mode === "checking") {
        setHealthBoth(next);
      }
    }, CHECK_DELAY_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hidden, hook, apply, retry]);

  return { health, onSceneChange, overlay: grid.enabled && health.mode === "overlay" };
}
