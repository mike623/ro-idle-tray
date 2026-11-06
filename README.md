<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="RO Idle Tray" width="128">

# RO Idle Tray

[![Release](https://img.shields.io/github/v/release/mike623/ro-idle-tray?style=flat-square)](https://github.com/mike623/ro-idle-tray/releases/latest)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB?style=flat-square&logo=tauri)](https://tauri.app)

macOS menu-bar companion for [ro-idle.app](https://ro-idle.app/): run several accounts side by side, watch every character from one panel, and ask an AI assistant that knows the game data.

[Features](#features) • [Install](#install) • [Development](#development) • [References](#references) • [Release](#release)

</div>

The game stays hosted remotely and sign-in stays with the site. The tray wraps it in isolated WebViews, reads what the page already loads, and adds tools on top.

## Features

- **Multiple accounts.** Each profile gets its own WebView data directory, so Google cookies never mix. Sign in once per profile; the session is kept.
- **Character panel.** One list for all characters with name, Base/Job level, map and status. Characters needing attention float up; filter by status, switch to a compact view, or pin the panel above other windows.
- **Bulk actions.** Idle All / Stop All, send everyone back to their save point, or wake every offline character to refresh its data.
- **Per-character modes.** Online (keep the game page alive in the background) or Offline, plus **assist** (fight back only when hit) and **lure** (pull every monster on the map). Modes re-apply automatically after a map change.
- **Map & monster atlas.** Offline atlas of maps, spawns and aggressive monsters, with EXP-efficiency map ranking. Move a character from the atlas using the game's own map command.
- **Item settings editor.** Edit every character's 道具設定 (items + recovery) in one table and apply to all.
- **Class chart & guides.** Novice-to-4th class progression chart, and player guides from [ned-lin-9527.github.io/Ragnarok](https://ned-lin-9527.github.io/Ragnarok/) cached for a day.
- **AI assistant (助理).** Chat in its own window; `@角色` scopes a question to one character. It reads game data, battle logs and skills, suggests stat/skill plans that apply with one click, and keeps an editable Markdown memory. Short lessons pop up when the log shows a real problem.
- **Local read-only API.** `http://127.0.0.1:47615` (bearer token) serves the latest character snapshots and mirrored battle logs for your own scripts.
- **Auto-updates.** Checks GitHub Releases on launch and every 6 h. An `Update to vX.Y.Z…` item appears; nothing installs until you click it.

> [!NOTE]
> The assistant is model-agnostic. It talks to any Anthropic Messages-compatible endpoint, by default a local [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), so any model it proxies works. Web search goes through Tavily's hosted MCP server (search and extract only). API keys are encrypted at rest in the app config dir and never reach the game windows.

## Install

Download the `.dmg` from [Releases](https://github.com/mike623/ro-idle-tray/releases/latest).

> [!IMPORTANT]
> The build is not Apple-signed or notarized. The first time, right-click the app › **Open** › **Open**.

## Development

**Requirements:** macOS, [Node.js](https://nodejs.org/), and the [Rust toolchain](https://rustup.rs/) (see [Tauri prerequisites](https://tauri.app/start/prerequisites/)).

```sh
npm install
npm run tauri dev
```

Run the tests:

```sh
node --test
cargo test --manifest-path src-tauri/Cargo.toml
```

Build a release bundle (output: `src-tauri/target/release/bundle/macos/ro-idle-tray.app`):

```sh
npm run tauri build
```

> [!TIP]
> Dev builds record raw API traffic to `<app config>/capture/*.jsonl` (`src/capture.js`; auth calls are never recorded). `scripts/capture-gaps.py` and `scripts/formula-check.py` analyse those captures for the offline-backend work in [`docs/offline-backend`](docs/offline-backend).

### Project layout

| Path | Contents |
|------|----------|
| `src/` | Panel, assistant, atlas, item editor and class chart windows (plain HTML/JS), plus the game-page hooks |
| `src-tauri/src/` | Rust backend: tray and windows (`lib.rs`), chat and AI provider, knowledge tools, alerts, local API, encrypted secrets |
| `scripts/extract-maps.mjs` | Extracts monsters, maps, skills and items from the game bundle into `src/game-data.json` / `src/item-info.json` |
| `tests/` | Node test suites for the frontend helpers |

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

## Release

Version source of truth: `src-tauri/tauri.conf.json` `version`. Keep `src-tauri/Cargo.toml` and `package.json` equal to it.

1. Bump the version in those 3 files.
2. Commit.
3. `git tag vX.Y.Z && git push && git push --tags`

`.github/workflows/release.yml` checks the tag matches `tauri.conf.json`, builds a universal macOS app, and publishes the `.dmg`, `.app.tar.gz`, `.sig` and `latest.json` (the updater feed) to the GitHub Release.

> [!WARNING]
> Updates are signed with the key in `~/.tauri/ro-idle-tray.key`, stored as the `TAURI_SIGNING_PRIVATE_KEY` repo secret; the public half is in `tauri.conf.json`. Losing the private key means existing installs can no longer auto-update.
