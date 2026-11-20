import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import { App } from "./App";

// Fonts are bundled locally (web/public/fonts), so the app works offline.
window.EXCALIDRAW_ASSET_PATH = `${window.location.origin}/`;

createRoot(document.getElementById("root")!).render(<App />);
