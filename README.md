# RO Idle Tray

Small macOS menu-bar wrapper for https://ro-idle.app/.

- Left-click tray icon opens Google Account 1.
- Click tray icon to choose an account, Add Profile…, or Quit. Profile count persists in the app config dir (`profile-count`).
- Each profile uses a separate WebView data directory, keeping Google cookies isolated.
- Menu label switches from `Account N` to `Name — Base Lv / Job Lv` once that profile's character loads (hooks the page's fetch + EventSource; emit-only IPC via `capabilities/remote.json`).
- Game remains hosted remotely; authentication stays with the site.
- Battle view (character detail › 行動): side-view replay of the party's live battle log in the RO client's own art and window chrome. Sprites, effects and UI textures are fetched from public mirrors (latam-tools zrenderer, ro-idle.app, ro-survivors, rangarok-js) through `roasset://` and cached in the app cache dir, so watched maps work offline; nothing from Gravity is bundled. The pixel font is Fusion Pixel 12px (OFL, `src/fonts/`). See #21.
- Tray shows the running version (`RO Idle Tray vX.Y.Z`). It checks GitHub Releases on launch and every 6h; when a newer build exists an `Update to vX.Y.Z…` item appears. Nothing installs or restarts until you click it.

## References

Game sources used by the tray, the assistant, and the offline-backend work:

- [ro-idle.app/info](https://ro-idle.app/info) — official site: [更新紀錄](https://ro-idle.app/info/updates), [新手指南](https://ro-idle.app/info/guide), [玩法與公式](https://ro-idle.app/info/mechanics) (stat, damage, HIT/FLEE, ASPD, cast, regen, death, offline-settlement rules "from the game's actual code"), [資料查詢](https://ro-idle.app/info/database).
- Game bundle `https://ro-idle.app/assets/index-*.js` — static data literal (monsters, maps, skills, items) extracted by `scripts/extract-maps.mjs` into `src/game-data.json` / `src/item-info.json`; also the client API surface (`/api/characters/:id/{commands,stream,events,...}`).
- [ned-lin-9527.github.io/Ragnarok](https://ned-lin-9527.github.io/Ragnarok/) ([repo](https://github.com/ned-lin-9527/Ragnarok)) — player guides and dated skill-tree / equipment data dumps; read live by `src-tauri/src/guide.rs`.
- [nba9001-sys/ro-idle](https://github.com/nba9001-sys/ro-idle) — a different, client-only RO idle game (諸神放置錄). Not ro-idle.app; useful only as a reference simulation engine.
- [iRO Wiki Classic](https://irowiki.org/classic/) — pre-renewal mechanics. ro-idle.app names it and rAthena as its sources ("遊戲數值參考 rAthena 開源專案與 iRO Wiki Classic 的公開資料"); its homunculus help also says "原版 pre-re". Explains mechanics in plain language; where it differs from rAthena (e.g. player soft DEF), captures side with rAthena — always verify.
- [Ragnarok Research Lab](https://ragnarokresearchlab.github.io/community-projects/) — index of RO server emulators. They speak the original RO packet protocol, not ro-idle.app's HTTP/SSE API, so they are formula references only (damage pipeline order, DEF, rounding); always verify against captures, since ro-idle.app says its rules differ from other RO versions.
  - [rAthena](https://github.com/rathena/rathena) / [Hercules](https://github.com/HerculesWS/Hercules) — GPL-3.0: read for reference, don't copy code.
  - [rust-ro](https://github.com/nmeylan/rust-ro) — MIT, Rust; battle/status code can be reused with attribution.
- Dev builds record raw API traffic to `<app config>/capture/*.jsonl` (`src/capture.js`) for building an offline backend against real payloads.

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
