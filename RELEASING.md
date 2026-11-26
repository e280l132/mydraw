# Releasing mydraw

How to publish a new version that installed apps will offer as an update. For the design (why GitHub Releases, how the in-app updater works) see CLAUDE.md "Packaging, versions and updates".

## Where the build output goes

`npm run package` writes to `release/` in the repo (git-ignored):

| What | Path |
|---|---|
| The app | `release/mac-arm64/mydraw.app` |
| The disk image you give people | `release/mydraw-<version>-arm64.dmg` |
| Checksum (made by the release script) | `release/mydraw-<version>-arm64.dmg.sha256` |

The DMG window shows the app, an Applications shortcut and, on its background, the drag arrow and the first-launch note (`packaging/dmg-background.html`; after editing it run `npm run dmg-background` and commit the TIFF). To try the app yourself without publishing: `npm run install-app` copies `mydraw.app` into `/Applications` (quit mydraw first) and creates the `mydraw` command.

## Version numbers

- Format: `major.minor` (0.1, 0.2, … 1.0 when you call it finished). A third number is for bug-fix builds (0.1.1).
- You don't edit the number by hand: `npm run release -- minor` bumps `package.json` for you.
- Users see the short form: "mydraw 0.2" (0.2.0 is shown as 0.2; 0.2.1 as 0.2.1).

## Publishing a release

1. **Be on `main` with a clean tree.** Commit all work first. `git status` should be empty.
2. **Write the release notes.** Add a section to `CHANGELOG.md`:
   ```
   ## 0.2
   - what changed, one line per item
   ```
   The text under the heading is what users see under "What's new". The release stops if the section is missing or empty. Commit it.
3. **Make sure you have `gh` logged in** (`gh auth status`). The release is created with GitHub's CLI.
4. **Run the release:**
   ```bash
   npm run release -- minor        # 0.1 -> 0.2 (the usual one)
   npm run release -- patch        # 0.2 -> 0.2.1 (bug-fix build only)
   npm run release -- 0.2.0        # an explicit version
   ```
   Add `--no-smoke` to skip the browser smoke test (it takes a few minutes; keep it for real releases).
5. **What the script does:** bumps `package.json`, runs typecheck, unit tests, smoke test, builds the DMG, runs `verify-package`, and writes the `.sha256`. Then it prints a summary and asks:
   ```
   Publish? This pushes to GitHub and makes the update visible to installed apps. [y/N]
   ```
   Type `y` only when you are happy with the summary. Anything else stops and restores `package.json`; nothing is pushed.
6. **After `y`:** it commits `Release 0.2.0`, creates the tag `v0.2.0`, pushes `main` and the tag, and creates the GitHub release with the DMG, the `.sha256` and your notes.
7. **Check it:** open the release page it prints, confirm both files are attached. In an installed copy of mydraw, Help → Check for Updates… should now offer the new version.

If something fails before the prompt, nothing was published: fix it and run again. If it fails after `y` (for example a network error during push), look at `git status`, `git tag` and the GitHub release page, and finish the missing step by hand (`git push origin main`, `git push origin v0.2.0`, `gh release create v0.2.0 <dmg> <sha> --notes-file <notes>`).

## Testing an update before people get it

- Automated: `npm run verify-package` runs a real update (0.1.0 → 0.1.1) against a fake release server, so it never touches GitHub.
- By hand, after publishing: install the previous release's DMG into /Applications, open it, and check Help → Check for Updates… offers the new version.

## Things to know

- **Unsigned app.** Users open it once with right-click → Open. Updates are downloaded and checked by SHA-256, not by an Apple signature, so the trust is in this GitHub repository. Protect your GitHub account (2FA) accordingly.
- **Only Apple Silicon** (arm64) is built.
- **Once published, a release can't be quietly taken back.** Installed apps may already have downloaded it. To retract, publish a higher version with the fix.
- **Skipped versions:** a user who chose "Skip this version" is not offered it again automatically, but a manual Check for Updates offers it.
