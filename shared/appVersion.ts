// The app version, injected at build time from package.json (see shared/buildConstants.d.ts).
import { displayVersion } from "./version";

export const APP_VERSION: string = typeof __MYDRAW_VERSION__ === "string" ? __MYDRAW_VERSION__ : "0.0.0";
/** "0.1", "0.1.1": what people see. */
export const APP_VERSION_LABEL = displayVersion(APP_VERSION);
