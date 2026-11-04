# Graph Report - re-implement-server-backend-offline  (2026-11-04)

## Corpus Check
- 58 files · ~93,481 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 6 file(s) not represented in the graph (top: (none) 3, .icns 1, .ico 1)

## Summary
- 811 nodes · 1590 edges · 49 communities (31 shown, 18 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a2682cce`
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
- bubble.test.mjs
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
- open_profile
- ref_node_assert
- items.test.mjs
- tutorial.test.mjs
- extract-maps.test.mjs
- capture.test.mjs
- panel.test.mjs
- run
- knowledge.rs
- Capture gap report (#12)

## God Nodes (most connected - your core abstractions)
1. `run()` - 20 edges
2. `window_scope()` - 17 edges
3. `chat_send()` - 16 edges
4. `respond()` - 15 edges
5. `card()` - 15 edges
6. `notify()` - 14 edges
7. `checks()` - 13 edges
8. `refresh()` - 13 edges
9. `ai_test_connection()` - 12 edges
10. `open_profile()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `clip()`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/ai.rs
- `agent()` --references--> `AiConfig`  [EXTRACTED]
  src-tauri/src/chat.rs → src-tauri/src/ai.rs
- `scoped_agent()` --references--> `AiConfig`  [EXTRACTED]
  src-tauri/src/chat.rs → src-tauri/src/ai.rs
- `show()` --calls--> `showPanel()`  [EXTRACTED]
  src/chat.js → src/panel.js
- `refresh()` --calls--> `overview()`  [EXTRACTED]
  src/main.js → src/compact.js

## Import Cycles
- None detected.

## Communities (49 total, 18 thin omitted)

### Community 0 - "lib.rs"
Cohesion: 0.07
Nodes (15): AUTO_OFFLINE_AFTER, CHARACTER_HOOK, export_dir(), export_path(), JOB_NAMES, LAUNCH_AGENT_LABEL, open_export_folder(), open_exports() (+7 more)

### Community 1 - "main.js"
Cohesion: 0.06
Nodes (60): close(), names, roster(), show(), attention(), overview(), shown(), after() (+52 more)

### Community 2 - "tauri.conf.json"
Cohesion: 0.09
Nodes (21): app, macOSPrivateApi, security, windows, withGlobalTauri, build, frontendDist, bundle (+13 more)

### Community 3 - "js_dialogs.rs"
Cohesion: 0.19
Nodes (5): alert_imp(), confirm_imp(), install(), prompt_imp(), run()

### Community 4 - "extract-maps.mjs"
Cohesion: 0.11
Nodes (17): boss(), data, html, items, json, knowledge, lv(), maps (+9 more)

### Community 5 - "chat.rs"
Cohesion: 0.05
Nodes (68): agent(), AlertView, anthropic_stream_and_model_written_compaction_work(), append(), archive(), character_chat_cannot_read_other_characters_even_when_model_requests_them(), character_threads_are_isolated_and_cannot_escape_chat_directory(), chat_alert_ack() (+60 more)

### Community 6 - "api.rs"
Cohesion: 0.06
Nodes (48): ApiConfig, authorized(), BEARER, bind(), binds_loopback_and_serves_http(), character_events(), dedupes_replayed_events_by_seq(), DEFAULT_LIMIT (+40 more)

### Community 7 - "ai.rs"
Cohesion: 0.08
Nodes (31): ai_get_settings(), ai_list_models(), ai_save_settings(), ai_test_connection(), AiConfig, ANTHROPIC_VERSION, api_key(), caching_verdict() (+23 more)

### Community 8 - "package.json"
Cohesion: 0.20
Nodes (9): devDependencies, @tauri-apps/cli, name, private, scripts, tauri, type, version (+1 more)

### Community 9 - "remote.json"
Cohesion: 0.25
Nodes (7): description, identifier, permissions, remote, urls, $schema, windows

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
Cohesion: 0.15
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

### Community 23 - "bubble.test.mjs"
Cohesion: 0.25
Nodes (4): environment(), window, source, tick()

### Community 25 - "secret.rs"
Cohesion: 0.11
Nodes (17): AI_FILE, file_path(), load(), load_named(), NONCE_LEN, rejects_tampered_or_unknown_blobs(), roundtrip_binds_to_the_machine(), SALT (+9 more)

### Community 26 - "formula-check.py"
Cohesion: 0.11
Nodes (12): atk(), bonuses(), captures(), checks(), equipped(), formula_inventory(), Literal, main() (+4 more)

### Community 27 - "alerts.rs"
Cohesion: 0.10
Nodes (32): acknowledge(), Alert, Alerts, badge(), death_stop_and_supply_halt_are_unique_with_log_causes(), event_text(), ingest(), load() (+24 more)

### Community 33 - "items.js"
Cohesion: 0.26
Nodes (11): RO_IDLE_ITEM_KEYS, RO_IDLE_ITEM_LISTS, RO_IDLE_ITEM_RULES, roIdleApplyItems(), roIdleItemList(), roIdleItemRow(), roIdleItemsFor(), roIdlePickItems() (+3 more)

### Community 34 - "CharacterLabel"
Cohesion: 0.18
Nodes (12): CharacterLabel, get_groups(), get_state(), launch_agent_path(), PanelState, ProfileView, set_autostart(), set_groups() (+4 more)

### Community 35 - "run"
Cohesion: 0.14
Nodes (18): add_account(), add_profile(), enter_character(), hide_panel(), hide_panel_window(), install_update(), open_atlas(), open_classes() (+10 more)

### Community 36 - "write_panel_geometry"
Cohesion: 0.33
Nodes (7): load_panel_geometry(), panel_geometry_path(), PanelGeom, PanelLayout, save_panel_geometry(), set_pinned(), write_panel_geometry()

### Community 37 - "character_report"
Cohesion: 0.50
Nodes (4): place_panel(), restore_panel(), set_panel_width(), show_panel()

### Community 38 - "open_profile"
Cohesion: 0.21
Nodes (13): auto_offline_tick(), confirm_remove(), dialog(), open_account(), open_profile(), poll_profiles(), profile_number(), profile_store_id() (+5 more)

### Community 46 - "run"
Cohesion: 0.18
Nodes (17): character_report(), check_update(), goals_path(), items_characters(), job_name(), load_map(), load_nicknames(), load_profile_ids() (+9 more)

### Community 47 - "knowledge.rs"
Cohesion: 0.38
Nodes (8): DATA, live_game_lookup_contains_spore_sleep_water_and_attack(), lookup(), lookup_in(), map_monsters(), rank(), rank_in(), ranking_flags_aggressive_damage_and_respects_level_limit_and_bonus()

### Community 48 - "Capture gap report (#12)"
Cohesion: 0.25
Nodes (6): Formula evidence for the offline backend, Capture gap report (#12), Commands (#12 checklist, one character), Covered, Missing, Next captures (targeted, short)

## Knowledge Gaps
- **4 isolated node(s):** `@tauri-apps/cli`, `ro-idle-tray`, `Text`, `Tool`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 300 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AiConfig` connect `ai.rs` to `chat.rs`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `@tauri-apps/cli`, `ro-idle-tray`, `Text` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.07226890756302522 - nodes in this community are weakly interconnected._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06394230769230769 - nodes in this community are weakly interconnected._
- **Should `tauri.conf.json` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `extract-maps.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10952380952380952 - nodes in this community are weakly interconnected._
- **Should `chat.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.05390893470790378 - nodes in this community are weakly interconnected._