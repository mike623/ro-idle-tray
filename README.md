# RO Idle Tray

Small macOS menu-bar wrapper for https://ro-idle.app/.

- Left-click tray icon opens Google Account 1.
- Click tray icon to choose an account, Add Profile…, or Quit. Profile count persists in the app config dir (`profile-count`).
- Each profile uses a separate WebView data directory, keeping Google cookies isolated.
- Menu label switches from `Account N` to `Name — Base Lv / Job Lv` once that profile's character loads (hooks the page's fetch + EventSource; emit-only IPC via `capabilities/remote.json`).
- Game remains hosted remotely; authentication stays with the site.
- Tray shows the running version (`RO Idle Tray vX.Y.Z`). It checks GitHub Releases on launch and every 6h; when a newer build exists an `Update to vX.Y.Z…` item appears. Nothing installs or restarts until you click it.

## Install

Download the `.dmg` from [Releases](https://github.com/mike623/ro-idle-tray/releases/latest). The build is not Apple-signed or notarized, so the first time: right-click the app › **Open** › **Open**.

## Run

```sh
npm install
npm run tauri dev
```

## Build

```sh
npm run tauri build
```

App bundle: `src-tauri/target/release/bundle/macos/ro-idle-tray.app`.

## Release

Version source of truth: `src-tauri/tauri.conf.json` `version`. Keep `src-tauri/Cargo.toml` and `package.json` equal to it.

1. Bump the version in those 3 files.
2. Commit.
3. `git tag vX.Y.Z && git push && git push --tags`

`.github/workflows/release.yml` checks the tag matches `tauri.conf.json`, builds a universal macOS app, and publishes the `.dmg`, `.app.tar.gz`, `.sig` and `latest.json` (the updater feed) to the GitHub Release. Updates are signed with the key in `~/.tauri/ro-idle-tray.key`, stored as the `TAURI_SIGNING_PRIVATE_KEY` repo secret; the public half is in `tauri.conf.json`. Losing the private key means existing installs can no longer auto-update.
