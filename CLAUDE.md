# mydraw — notes for agents

Roadmap and phase status: `plan.md`. Read it before starting a phase.

## Architecture
- `app/src/main.ts`: Electron main. Serves `web/dist` over the privileged `app://mydraw` scheme (prod) or loads `MYDRAW_DEV_URL` (dev). All file I/O, dialogs, menus, settings and the crash-recovery folder live here. The renderer may only write to paths the user opened or picked (`allowedPaths`).
- `app/src/preload.ts`: exposes `window.mydraw` (typed by `MydrawBridge` in `shared/types.ts`). Context isolation + sandbox on; add new IPC here and in `shared/types.ts` together.
- `web/src/App.tsx`: tabs, save/autosave, recovery, file-watch conflicts, close flow. One mounted `<Excalidraw>` per tab (hidden when inactive) so each keeps its own undo history. Latest state is read through refs (`tabsRef`, `settingsRef`, `apis`) because callbacks come from Excalidraw, IPC and timers.
- Dirty tracking: `sceneHash` (element versions + count + background) compared with a per-tab baseline set on first `onChange` after load, after save, and after reload.
- Drawing style (Clean/Sketch) sets `currentItem*` app state only; it never edits existing elements.

## Conventions
- Excalidraw is pinned to `0.18.1`. Import types from `@excalidraw/excalidraw/types` and `@excalidraw/excalidraw/element/types`.
- `process.env.IS_PREACT` must stay defined as `"false"` in `vite.config.ts`.
- Fonts are copied from the package into `web/public/fonts` by `scripts/build-app.mjs` (gitignored).
- Edit menu: undo/redo/select-all use `registerAccelerator: false` so the keys reach Excalidraw.
- No browser `alert/confirm`; use the main-process dialogs (`askUnsaved`) or in-app banners/toasts.

## Checks before committing
`npm run typecheck && npm test && npm run smoke`

The smoke test runs the built app with `MYDRAW_TEST=1` and a temp `MYDRAW_USER_DATA`, and uses the test-only `window.__mydrawTest` hook (`web/src/App.tsx`). Extend it when adding features.
