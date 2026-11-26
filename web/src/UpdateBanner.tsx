// "mydraw 0.2 is available" banner under the tab bar (in-app updates, app/src/updater.ts).
// Main sends the state on `update:status`; the buttons go back through `updateAction`.
import { useEffect, useRef, useState } from "react";
import { APP_VERSION_LABEL } from "../../shared/appVersion";
import type { UpdateAction, UpdateStatus } from "../../shared/update";
import { displayVersion } from "../../shared/version";

const bridge = window.mydraw;

export function UpdateBanner({ toast }: { toast(text: string, error?: boolean): void }) {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [notesOpen, setNotesOpen] = useState(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    let live = true;
    void bridge.getUpdateStatus().then((s) => live && setStatus(s));
    const off = bridge.onUpdateStatus(setStatus);
    return () => {
      live = false;
      off();
    };
  }, []);

  // One-line answers to a manual check are toasts, not banners.
  useEffect(() => {
    if (status.state === "latest") toastRef.current(`You have the latest version of mydraw (${displayVersion(status.version)}).`);
    else if (status.state === "unavailable") toastRef.current(status.reason);
    else return;
    setStatus({ state: "idle" });
  }, [status]);

  const act = (a: UpdateAction) => void bridge.updateAction(a).catch((e: Error) => toastRef.current(e.message, true));

  let body: React.ReactNode = null;
  switch (status.state) {
    case "checking":
      if (status.manual) body = <span>Checking for updates…</span>;
      break;
    case "available":
      body = (
        <>
          <span>
            <b>mydraw {displayVersion(status.version)}</b> is available (you have {APP_VERSION_LABEL}).
          </span>
          <button className="md-update-install" onClick={() => act("install")}>
            Update
          </button>
          {status.notes.trim() && <button onClick={() => setNotesOpen(true)}>What’s new</button>}
          <button className="md-update-skip" onClick={() => act("skip")}>
            Skip this version
          </button>
        </>
      );
      break;
    case "downloading":
      body = (
        <span>
          Downloading mydraw {displayVersion(status.version)}… {Math.round(status.progress * 100)}%
        </span>
      );
      break;
    case "ready":
      body = (
        <>
          <span>
            <b>mydraw {displayVersion(status.version)}</b> is ready. Restart to use it, or it installs when you quit.
          </span>
          <button className="md-update-restart" onClick={() => act("restart")}>
            Restart now
          </button>
        </>
      );
      break;
    case "error":
      body = (
        <>
          <span>{status.message}</span>
          <button onClick={() => act("openPage")}>Release page</button>
        </>
      );
      break;
  }

  return (
    <>
      {body && (
        <div className="md-banner md-update" data-update-state={status.state}>
          {body}
          {status.state !== "downloading" && status.state !== "checking" && (
            <button className="md-update-close" aria-label="Hide" title="Hide" onClick={() => act("dismiss")}>
              ×
            </button>
          )}
        </div>
      )}
      {notesOpen && status.state === "available" && (
        <div className="md-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setNotesOpen(false)}>
          <div className="md-modal md-update-notes" role="dialog" aria-modal="true" aria-label="What’s new">
            <h2>What’s new in mydraw {displayVersion(status.version)}</h2>
            <pre>{status.notes}</pre>
            <div className="md-modal-actions">
              <button onClick={() => setNotesOpen(false)}>Close</button>
              <button
                className="primary"
                onClick={() => {
                  setNotesOpen(false);
                  act("install");
                }}
              >
                Update
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
