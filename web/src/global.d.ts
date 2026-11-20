import type { MydrawBridge } from "../../shared/types";

declare global {
  interface Window {
    mydraw: MydrawBridge;
    EXCALIDRAW_ASSET_PATH?: string | string[];
    __mydrawTest?: unknown;
  }
}

export {};
