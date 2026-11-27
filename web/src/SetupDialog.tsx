// "Set up mydraw": Applications folder, the `mydraw` command, Claude Code (app/src/setup.ts does
// the work; shared/setup.ts has the model). Opens on the installed app's first launch and when it
// runs from the wrong place; also Preferences → "Command line & Claude Code…".
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isBundleCommand, type InstallTarget, type SetupAction, type SetupStatus } from "../../shared/setup";

const bridge = window.mydraw;
const CLAUDE_CODE_URL = "https://claude.com/claude-code";

export function SetupDialog({ onClose }: { onClose(): void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState<SetupAction | null>(null);
  const [error, setError] = useState<{ step: string; text: string } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [target, setTarget] = useState<InstallTarget | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void bridge.setupStatus().then(setStatus, (e: Error) => setError({ step: "all", text: e.message }));
    box.current?.focus();
  }, []);

  const act = (step: string, action: SetupAction) => async () => {
    setBusy(action);
    setError(null);
    try {
      setStatus(await bridge.setupAction(action, action === "move" ? (target ?? status?.location.suggested) : undefined));
      setConfirmReplace(false);
    } catch (e) {
      setError({ step, text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") });
    } finally {
      setBusy(null);
    }
  };
  const btn = (step: string, action: SetupAction, label: string, primary = false) => (
    <button className={`md-setup-btn${primary ? " primary" : ""}`} data-action={action} disabled={!!busy} onClick={act(step, action)}>
      {busy === action ? "Working…" : label}
    </button>
  );

  const s = status;
  const devBuild = s && !s.packaged;
  return (
    <div className="md-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        tabIndex={-1}
        className="md-modal md-setup"
        role="dialog"
        aria-modal="true"
        aria-label="Set up mydraw"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onClose();
        }}
      >
        <h2>Set up mydraw</h2>
        <p className="md-setup-hint">Nothing changes until you click a button, and each step can be undone. You can come back here any time: Preferences → Command line & Claude Code…</p>
        {!s && !error && <p>Checking…</p>}
        {devBuild && <p className="md-setup-dev">This is a development build: these steps work in the installed app (see README “Install”).</p>}
        {s && (
          <>
            <Row step="location" state={s.location.state} title="Applications folder" error={error?.step === "location" ? error.text : null}>
              {s.location.state === "ok" &&
                (s.location.installedIn === "user" ? (
                  <Done>Installed just for you, in {home(s.location.targets.user.dir)}.</Done>
                ) : (
                  <Done>mydraw is in {s.location.bundle?.replace(/\/mydraw\.app$/, "")}.</Done>
                ))}
              {s.location.state === "move" && (
                <>
                  <p>{s.location.reason}. Move it to Applications so updates and the steps below work. mydraw restarts from there.</p>
                  <div className="md-setup-targets" role="radiogroup" aria-label="Install for">
                    {(["system", "user"] as const).map((t) => {
                      const info = s.location.targets[t];
                      const chosen = (target ?? s.location.suggested) === t;
                      return (
                        <label key={t} className={`md-setup-target${chosen ? " on" : ""}${info.writable ? "" : " off"}`} data-target={t}>
                          <input type="radio" name="md-setup-target" checked={chosen} disabled={!info.writable || !!busy} onChange={() => setTarget(t)} />
                          <span>
                            <b>{t === "system" ? "All users" : "Just for me"}</b> <code>{home(info.dir)}</code>
                            <small>{t === "system" ? (info.writable ? "For everyone on this Mac." : "Needs an administrator: you can't add apps here.") : "No administrator password needed."}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {btn("location", "move", "Move", true)}
                </>
              )}
              {s.location.otherCopy && (
                <p className="md-setup-warn" data-other-copy>
                  Another copy of mydraw is in {home(s.location.otherCopy.replace(/\/mydraw\.app$/, ""))}. macOS may open drawings with that one: delete it in Finder if you don't need it.
                </p>
              )}
              {s.location.state === "dev" && <p>Development build.</p>}
            </Row>

            <Row step="command" state={s.command.state} title="The mydraw command" error={error?.step === "command" ? error.text : null}>
              <p className="md-setup-what">
                Lets you run <code>mydraw export drawing.excalidraw --format pdf</code> in Terminal. Adds a link at <code>{s.command.link.replace(/^\/Users\/[^/]+/, "~")}</code>.
              </p>
              {s.command.state === "installed" && (
                <>
                  <Done>Installed.</Done>
                  {!s.command.onPath && (
                    <p className="md-setup-warn">
                      Its folder is not on your Terminal’s PATH yet. Add this line to <code>~/.zshrc</code>, then open a new Terminal: <code>export PATH="$HOME/.local/bin:$PATH"</code>
                    </p>
                  )}
                  {btn("command", "removeCommand", "Remove")}
                </>
              )}
              {s.command.state === "missing" && btn("command", "installCommand", "Install the command", true)}
              {s.command.state === "other" &&
                (s.command.target && isBundleCommand(s.command.target) ? (
                  <>
                    <p>It points to another copy of mydraw ({s.command.target.replace(/\/Contents\/Resources\/bin\/mydraw$/, "")}).</p>
                    {btn("command", "installCommand", "Point it to this app", true)}
                  </>
                ) : (
                  <p className="md-setup-warn">Something else is already there{s.command.target ? ` (${s.command.target})` : ""}. Remove it yourself if you want the mydraw command.</p>
                ))}
              {s.command.state === "unavailable" && !devBuild && <p className="md-setup-muted">Move mydraw to Applications first.</p>}
            </Row>

            <Row step="claude" state={s.claude.state} title="Claude Code" error={error?.step === "claude" ? error.text : null}>
              <p className="md-setup-what">Lets Claude Code draw and edit diagrams in mydraw. Registers mydraw’s built-in MCP server with Claude Code (for all your projects).</p>
              {s.claude.state === "connected" && (
                <>
                  <Done>Connected. Restart Claude Code sessions that were already open.</Done>
                  {btn("claude", "disconnectClaude", "Disconnect")}
                </>
              )}
              {s.claude.state === "missing" && btn("claude", "connectClaude", "Connect Claude Code", true)}
              {s.claude.state === "other" && (
                <>
                  <p>
                    Claude Code already has a “mydraw” server: <code>{s.claude.existing}</code>
                  </p>
                  {confirmReplace ? (
                    <span className="md-setup-confirm">
                      Replace it with this app? {btn("claude", "connectClaude", "Replace", true)}
                      <button className="md-setup-btn" disabled={!!busy} onClick={() => setConfirmReplace(false)}>
                        Keep it
                      </button>
                    </span>
                  ) : (
                    <button className="md-setup-btn" data-action="askReplace" onClick={() => setConfirmReplace(true)}>
                      Use this app instead…
                    </button>
                  )}
                </>
              )}
              {s.claude.state === "noClaude" && (
                <>
                  <p>Claude Code is not installed on this Mac.</p>
                  <button className="md-setup-btn" onClick={() => window.open(CLAUDE_CODE_URL)}>
                    Get Claude Code
                  </button>
                  <button className="md-setup-btn" data-action="recheck" onClick={() => void bridge.setupStatus().then(setStatus)}>
                    Check again
                  </button>
                </>
              )}
              {s.claude.state === "unavailable" && !devBuild && <p className="md-setup-muted">Move mydraw to Applications first.</p>}
            </Row>
          </>
        )}
        {error?.step === "all" && <p className="md-setup-error">{error.text}</p>}
        <div className="md-modal-actions">
          <button className="primary md-setup-done" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ step, state, title, error, children }: { step: string; state: string; title: string; error: string | null; children: ReactNode }) {
  return (
    <section className="md-setup-row" data-step={step} data-state={state}>
      <h3>{title}</h3>
      {children}
      {error && <p className="md-setup-error">{error}</p>}
    </section>
  );
}

/** /Users/me/x -> ~/x */
const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

const Done = ({ children }: { children: ReactNode }) => <p className="md-setup-ok">✓ {children}</p>;
