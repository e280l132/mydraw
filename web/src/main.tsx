import "./assetPath";
import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import { App } from "./App";
import { fontsReady } from "./fontRegistry";

// Extra fonts are registered with Excalidraw before the first drawing mounts (a local manifest
// fetch; failures are logged and the app runs with Excalidraw's own fonts).
await fontsReady;

const root = createRoot(document.getElementById("root")!);
if (window.location.hash === "#headless") {
  // `mydraw` CLI: hidden window, no tabs/menus/autosave (see headless.tsx).
  void import("./headless").then(({ Headless }) => root.render(<Headless />));
} else {
  root.render(<App />);
}
