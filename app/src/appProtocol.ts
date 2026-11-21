// The privileged app:// scheme that serves web/dist (shared by the app and the headless CLI).
import { net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const APP_ORIGIN = "app://mydraw";

/** Call before app "ready", once, with any other schemes that need privileges. */
export function registerSchemes(extra: Electron.CustomScheme[] = []): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
    ...extra,
  ]);
}

/** Serve files under `webRoot` for app://mydraw/... (after "ready"). */
export function serveApp(webRoot: string): void {
  protocol.handle("app", (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(webRoot, decodeURIComponent(pathname)));
    if (!file.startsWith(webRoot + path.sep)) return new Response("forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
