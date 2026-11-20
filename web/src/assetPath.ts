// Must be the first import in main.tsx: Excalidraw reads EXCALIDRAW_ASSET_PATH when its module
// loads, and fonts must come from this app (web/public/fonts), never from a CDN.
window.EXCALIDRAW_ASSET_PATH = `${window.location.origin}/`;
export {};
