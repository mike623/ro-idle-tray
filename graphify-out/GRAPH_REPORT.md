# Graph Report - integ  (2026-11-04)

## Corpus Check
- 104 files · ~166,400 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 3, .jsonl 2, .icns 1)

## Summary
- 1591 nodes · 2800 edges · 64 communities (51 shown, 13 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 65 edges (avg confidence: 0.92)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `07cd3a93`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- lib.rs
- main.js
- tauri.conf.json
- js_dialogs.rs
- extract-maps.mjs
- chat.rs
- api.rs
- ai.rs
- package.json
- remote.json
- Element
- RO Idle Tray
- default.json
- Issue tracker: GitHub
- mcp.rs
- atlas-data.js
- ro-idle-tray
- guide.rs
- atlas.rs
- Domain Docs
- Agent skills
- 更新紀錄
- triage-labels.md
- secret.rs
- formula-check.py
- alerts.rs
- app.json
- refresh
- items.js
- CharacterLabel
- run
- write_panel_geometry
- character_report
- character_report
- ref_node_fs
- 能力、公式與掛機解答
- tutorial.test.mjs
- formulas.test.mjs
- engine.js
- createGame
- run
- population.mjs
- api-shapes.mjs
- run.mjs
- index.js
- brain.js
- formulas.js
- twin-diff.mjs
- offline.test.mjs
- Twin report (#23)
- serve.mjs
- Player population (load-test input)
- Load test (#24): first local run
- game.js
- playerDamage
- toggle_autostart
- rollMonsterDamage
- Snapshot: ro-idle.app/info/updates

## God Nodes (most connected - your core abstractions)
1. `更新紀錄` - 244 edges
2. `能力、公式與掛機解答` - 92 edges
3. `createGame()` - 24 edges
4. `run()` - 20 edges
5. `g` - 17 edges
6. `window_scope()` - 17 edges
7. `startServer()` - 16 edges
8. `chat_send()` - 16 edges
9. `respond()` - 15 edges
10. `card()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Bot population (server/loadtest/population.mjs, seed 1)` --references--> `derive()`  [INFERRED]
  docs/offline-backend/perf.md → server/rules/formulas.js
- `Rules engine (`server/rules/engine.js`, #17)` --references--> `at()`  [INFERRED]
  docs/offline-backend/formulas.md → scripts/api-shapes.mjs
- `GET /api/characters/:id/stream?after=<seq>&chatAfter=now|<chatId> — SSE` --references--> `events()`  [INFERRED]
  docs/offline-backend/api.md → scripts/api-shapes.mjs
- `What is a fight` --references--> `events()`  [INFERRED]
  docs/offline-backend/fight-corpus.md → scripts/api-shapes.mjs
- `Covered` --references--> `events()`  [INFERRED]
  docs/offline-backend/gaps.md → scripts/api-shapes.mjs

## Import Cycles
- None detected.

## Communities (64 total, 13 thin omitted)

### Community 0 - "lib.rs"
Cohesion: 0.07
Nodes (14): AUTO_OFFLINE_AFTER, CHARACTER_HOOK, export_dir(), export_path(), game_origin_ok(), JOB_NAMES, LAUNCH_AGENT_LABEL, open_export_folder() (+6 more)

### Community 1 - "main.js"
Cohesion: 0.06
Nodes (59): close(), names, roster(), show(), attention(), overview(), shown(), ago() (+51 more)

### Community 2 - "tauri.conf.json"
Cohesion: 0.09
Nodes (21): app, macOSPrivateApi, security, windows, withGlobalTauri, build, frontendDist, bundle (+13 more)

### Community 3 - "js_dialogs.rs"
Cohesion: 0.19
Nodes (5): alert_imp(), confirm_imp(), install(), prompt_imp(), run()

### Community 4 - "extract-maps.mjs"
Cohesion: 0.06
Nodes (36): `fights.jsonl` (one fight per line), Known limits (2026-11-04 captures), L2 fight corpus (#23), Sampling, What is a fight, buffsAt(), charIdOf(), charSnapshot() (+28 more)

### Community 5 - "chat.rs"
Cohesion: 0.05
Nodes (68): agent(), AlertView, anthropic_stream_and_model_written_compaction_work(), append(), archive(), character_chat_cannot_read_other_characters_even_when_model_requests_them(), character_threads_are_isolated_and_cannot_escape_chat_directory(), chat_alert_ack() (+60 more)

### Community 6 - "api.rs"
Cohesion: 0.06
Nodes (48): ApiConfig, authorized(), BEARER, bind(), binds_loopback_and_serves_http(), character_events(), dedupes_replayed_events_by_seq(), DEFAULT_LIMIT (+40 more)

### Community 7 - "ai.rs"
Cohesion: 0.09
Nodes (31): ai_get_settings(), ai_list_models(), ai_save_settings(), ai_test_connection(), AiConfig, ANTHROPIC_VERSION, api_key(), caching_verdict() (+23 more)

### Community 8 - "package.json"
Cohesion: 0.15
Nodes (12): dependencies, ws, devDependencies, @tauri-apps/cli, name, private, scripts, smoke (+4 more)

### Community 9 - "remote.json"
Cohesion: 0.25
Nodes (7): description, identifier, permissions, remote, urls, $schema, windows

### Community 10 - "Element"
Cohesion: 0.12
Nodes (5): Element, environment(), window, source, tick()

### Community 11 - "RO Idle Tray"
Cohesion: 0.29
Nodes (6): Build, Install, References, Release, RO Idle Tray, Run

### Community 12 - "default.json"
Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 13 - "Issue tracker: GitHub"
Cohesion: 0.29
Nodes (6): Conventions, Issue tracker: GitHub, Pull requests as a triage surface, Wayfinding operations, When a skill says "fetch the relevant ticket", When a skill says "publish to the issue tracker"

### Community 14 - "mcp.rs"
Cohesion: 0.09
Nodes (14): ALLOWED, CALL_TIMEOUT, CONNECT_TIMEOUT, ENDPOINT, failure(), MAX_RESULT_BYTES, raw_text(), reaches_the_hosted_server() (+6 more)

### Community 19 - "guide.rs"
Cohesion: 0.14
Nodes (15): article_text(), BASE, BUDGET, cached(), decode(), excerpt(), fetch(), live_guide_fetches_index_and_a_page() (+7 more)

### Community 20 - "atlas.rs"
Cohesion: 0.15
Nodes (24): all_in_play_are_selected_by_default(), apply_stats(), assist_mode(), atlas_characters(), is_atlas(), items_apply(), items_file(), items_merge() (+16 more)

### Community 21 - "Domain Docs"
Cohesion: 0.33
Nodes (5): Before exploring, read these, Domain Docs, File structure, Flag ADR conflicts, Use the glossary's vocabulary

### Community 22 - "Agent skills"
Cohesion: 0.40
Nodes (4): Agent skills, Domain docs, Issue tracker, Triage labels

### Community 23 - "更新紀錄"
Cohesion: 0.01
Nodes (244): 2026-10-15 · p5.10 — 危險偵測逃生、限時重置與商店查詢, 2026-10-15 · p5.11 — 重量、隊伍拾取、販售與輔助 SP 設定, 2026-10-15 · p5.12 — 拾取順序、組隊開關與冰牆施法修正, 2026-10-15 · p5.8 — 遠程射程與牆類技能修正, 2026-10-15 · p5.9 — 翅膀尋怪與隊友增益等級, 2026-10-16 · p5.14 — 隊友輔助選人、增益等級與補血提示修正, 2026-10-16 · p5.16 — 開放完整支援的套裝與寶箱裝備, 2026-10-16 · p5.17 — 瞬移逃生補位、輔助技能可選對象、統計手動歸零 (+236 more)

### Community 25 - "secret.rs"
Cohesion: 0.11
Nodes (17): AI_FILE, file_path(), load(), load_named(), NONCE_LEN, rejects_tampered_or_unknown_blobs(), roundtrip_binds_to_the_machine(), SALT (+9 more)

### Community 26 - "formula-check.py"
Cohesion: 0.10
Nodes (14): `summary.json`, atk(), bonuses(), captures(), checks(), equipped(), failing(), formula_inventory() (+6 more)

### Community 27 - "alerts.rs"
Cohesion: 0.08
Nodes (40): acknowledge(), Alert, Alerts, badge(), death_stop_and_supply_halt_are_unique_with_log_causes(), event_text(), ingest(), load() (+32 more)

### Community 33 - "items.js"
Cohesion: 0.26
Nodes (11): RO_IDLE_ITEM_KEYS, RO_IDLE_ITEM_LISTS, RO_IDLE_ITEM_RULES, roIdleApplyItems(), roIdleItemList(), roIdleItemRow(), roIdleItemsFor(), roIdlePickItems() (+3 more)

### Community 34 - "CharacterLabel"
Cohesion: 0.24
Nodes (9): CharacterLabel, get_groups(), Profiles, ProfileView, Roster, RosterChar, set_groups(), Target (+1 more)

### Community 35 - "run"
Cohesion: 0.12
Nodes (27): add_account(), add_profile(), auto_offline_tick(), enter_character(), hide_panel(), hide_panel_window(), install_update(), open_account() (+19 more)

### Community 36 - "write_panel_geometry"
Cohesion: 0.33
Nodes (7): load_panel_geometry(), panel_geometry_path(), PanelGeom, PanelLayout, save_panel_geometry(), set_pinned(), write_panel_geometry()

### Community 37 - "character_report"
Cohesion: 0.50
Nodes (4): place_panel(), restore_panel(), set_panel_width(), show_panel()

### Community 38 - "character_report"
Cohesion: 0.29
Nodes (7): character_report(), confirm_remove(), dialog(), job_name(), profile_number(), remove_account(), toast()

### Community 39 - "ref_node_fs"
Cohesion: 0.09
Nodes (10): data, items, jobs, start, p(), arrows, snapshot, get() (+2 more)

### Community 40 - "能力、公式與掛機解答"
Cohesion: 0.02
Nodes (92): 3 克拉鑽石可以換什麼？, ASPD 代表每秒打幾下？, DEF、MDEF 與 VIT／INT 都會減傷嗎？, DEX 會減少詠唱嗎？INT 呢？, DEX 詠唱試算, HIT、FLEE、暴擊和完全迴避有什麼不同？, Job 40 跟 50 轉職，永久屬性會不同嗎？, MATK 與 INT 的關係是什麼？ (+84 more)

### Community 42 - "formulas.test.mjs"
Cohesion: 0.10
Nodes (11): BUNDLE, captureRecords(), DERIVED, items, jsCounts(), merchant, merchantJob, ORACLE (+3 more)

### Community 43 - "engine.js"
Cohesion: 0.06
Nodes (57): Battle event — `{seq, body, wallMs, simTime}`, Kill / EXP per hour (`node tests/l2-rates.mjs`), L2 replay (`node tests/l2-fights.mjs 1000`, test `tests/engine-l2.test.mjs`), Rules engine (`server/rules/engine.js`, #17), l2(), applyDeath(), approach(), brainAction() (+49 more)

### Community 44 - "createGame"
Cohesion: 0.07
Nodes (28): Auth, Client brain (#19) and Beta tray, Gaps (defaults picked, not verified against ro-idle.app), Offline checkout (#18, `server/offline.js`), Owned rules server (#16), REST (captured shapes, docs/offline-backend/api.md), Run, Scripted session (seed → connect → search → fight → kill → loot) (+20 more)

### Community 46 - "run"
Cohesion: 0.21
Nodes (14): check_update(), goals_path(), items_characters(), load_map(), load_nicknames(), load_profile_ids(), nicknames_path(), notify() (+6 more)

### Community 47 - "population.mjs"
Cohesion: 0.09
Nodes (35): allocate(), archetypeConfig(), bucket(), character(), FAMILY, FARM_MAPS, FIRST, fits() (+27 more)

### Community 48 - "api-shapes.mjs"
Cohesion: 0.05
Nodes (40): GET /api/characters, GET /api/characters/:id?deferCatchup=1 — character view, GET /api/characters/:id/events?after=<seq>&limit=1000, GET /api/characters/:id/party, GET /api/characters/:id/stream?after=<seq>&chatAfter=now|<chatId> — SSE, GET /api/characters/:id/summary?after=<seq> — away summary, GET /api/kill-event — server-wide event, GET /api/maps/population (+32 more)

### Community 49 - "run.mjs"
Cohesion: 0.10
Nodes (28): cheater(), cheatRng, cheats, child, cl, clientWindow(), db, dir (+20 more)

### Community 50 - "index.js"
Cohesion: 0.12
Nodes (17): ws, runTwins(), CHAR_STUBS, openStore(), raw(), readJson(), startServer(), serveBrain() (+9 more)

### Community 51 - "brain.js"
Cohesion: 0.17
Nodes (23): condOk(), createBrain(), decide(), drop1(), fight(), observe(), onEvent(), onResult() (+15 more)

### Community 52 - "formulas.js"
Cohesion: 0.13
Nodes (21): Investigation: the `castMs_DEX` miss (resolved: capture gap), aspd(), bonuses(), BUFFS, castMs(), counter(), derive(), ELEMENT_TABLE (+13 more)

### Community 53 - "twin-diff.mjs"
Cohesion: 0.20
Nodes (10): charId(), compareRate(), COUNTS, fmt(), l3Table(), METRICS, parse(), realSessions() (+2 more)

### Community 54 - "offline.test.mjs"
Cohesion: 0.23
Nodes (11): add(), attachOffline(), sample(), blank(), halve(), IDLE_MS, lines, world() (+3 more)

### Community 55 - "Twin report (#23)"
Cohesion: 0.20
Nodes (10): L1 formulas (`scripts/formula-check.py`), L1: four adopted formulas failed on the latest captures; all four resolved, L2 fight replay (engine, 1000 seeds per fight, real within simulated p5–p95 on duration, damage taken, hits), L2: passes (92.2% ≥ 90%), L3: fails, as expected from the known brain gaps, L3 session rates (twins: our brain + server), L4 offline checkout, Triage (hand-written, 2026-11-04) (+2 more)

### Community 56 - "serve.mjs"
Cohesion: 0.22
Nodes (5): at, cpu, loop, m, { values: o }

### Community 57 - "Player population (load-test input)"
Cohesion: 0.25
Nodes (5): Per-character load (captures, 8 characters, 20.8 character-hours), Player population (load-test input), What a config contains (29 full configs, one per job), Where players are (`/api/maps/population`), Which jobs (`/api/shared-configs`, weighted by `using`)

### Community 58 - "Load test (#24): first local run"
Cohesion: 0.25
Nodes (8): Bot population (server/loadtest/population.mjs, seed 1), Load test (#24): first local run, Not run / gaps, Projected hosting cost per 1,000 driven characters (from the S1 1,000 step), S1 ramp: 100 → 250 → 500 → 1,000 driven characters, 2.5 min steady each (20 s warm-up excluded), S2 login storm: 1,000 characters, 30% driven, 200 offline characters return within 10 s, S6 cheating bots: 500 bots (475 honest + 25 cheaters, 5%) + one account boxing 12 characters, The tail: whole-state checkpoints

### Community 59 - "game.js"
Cohesion: 0.33
Nodes (4): data, DEFAULT_KILL_EVENT, game, rules

### Community 60 - "playerDamage"
Cohesion: 0.38
Nodes (7): katarOffhand(), physicalArgs(), physicalRolls(), playerDamage(), playerDamageRange(), rollPlayerDamage(), sizeMod()

### Community 61 - "toggle_autostart"
Cohesion: 0.40
Nodes (6): get_state(), launch_agent_path(), PanelState, set_autostart(), set_login(), toggle_autostart()

### Community 62 - "rollMonsterDamage"
Cohesion: 0.50
Nodes (5): monsterDamage(), monsterDamageRange(), playerSoftDefRange(), rollMonsterDamage(), uniformInt()

## Knowledge Gaps
- **4 isolated node(s):** `@tauri-apps/cli`, `ro-idle-tray`, `Text`, `Tool`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 810 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does ``summary.json`` connect `formula-check.py` to `engine.js`, `extract-maps.mjs`?**
  _High betweenness centrality (0.291) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `createGame()` (e.g. with `addItem()` and `combatOf()`) actually correct?**
  _`createGame()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@tauri-apps/cli`, `ro-idle-tray`, `Text` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.06951871657754011 - nodes in this community are weakly interconnected._
- **Why does `mobSkill()` connect `engine.js` to `formula-check.py`, `extract-maps.mjs`?**
  _High betweenness centrality (0.272) - this node is a cross-community bridge._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06498015873015874 - nodes in this community are weakly interconnected._
- **Should `tauri.conf.json` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._