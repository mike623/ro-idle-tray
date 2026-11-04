# Graph Report - ro-idle-tray  (2026-11-04)

## Corpus Check
- 54 files · ~77,935 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 2, .icns 1, .ico 1)

## Summary
- 773 nodes · 1528 edges · 47 communities (28 shown, 19 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6925bcb5`
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
- .on_dispatch
- alerts.rs
- app.json
- refresh
- items.js
- items_characters
- run
- run
- character_report
- open_profile
- items.test.mjs
- tutorial.test.mjs
- extract-maps.test.mjs
- capture.test.mjs
- panel.test.mjs
- set_nickname

## God Nodes (most connected - your core abstractions)
1. `run()` - 20 edges
2. `window_scope()` - 17 edges
3. `chat_send()` - 16 edges
4. `respond()` - 15 edges
5. `card()` - 15 edges
6. `notify()` - 14 edges
7. `refresh()` - 13 edges
8. `ai_test_connection()` - 12 edges
9. `open_profile()` - 12 edges
10. `row()` - 11 edges

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

## Communities (47 total, 19 thin omitted)

### Community 0 - "lib.rs"
Cohesion: 0.08
Nodes (18): AUTO_OFFLINE_AFTER, CHARACTER_HOOK, CharacterLabel, get_state(), JOB_NAMES, LAUNCH_AGENT_LABEL, launch_agent_path(), PanelState (+10 more)

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
Cohesion: 0.06
Nodes (67): agent(), AlertView, anthropic_stream_and_model_written_compaction_work(), append(), archive(), character_chat_cannot_read_other_characters_even_when_model_requests_them(), character_threads_are_isolated_and_cannot_escape_chat_directory(), chat_alert_ack() (+59 more)

### Community 6 - "api.rs"
Cohesion: 0.07
Nodes (48): ApiConfig, authorized(), BEARER, bind(), binds_loopback_and_serves_http(), character_events(), dedupes_replayed_events_by_seq(), DEFAULT_LIMIT (+40 more)

### Community 7 - "ai.rs"
Cohesion: 0.09
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
Cohesion: 0.07
Nodes (31): article_text(), BASE, BUDGET, cached(), decode(), excerpt(), fetch(), live_guide_fetches_index_and_a_page() (+23 more)

### Community 20 - "atlas.rs"
Cohesion: 0.14
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

### Community 27 - "alerts.rs"
Cohesion: 0.14
Nodes (24): acknowledge(), Alert, Alerts, badge(), death_stop_and_supply_halt_are_unique_with_log_causes(), event_text(), ingest(), load() (+16 more)

### Community 33 - "items.js"
Cohesion: 0.26
Nodes (11): RO_IDLE_ITEM_KEYS, RO_IDLE_ITEM_LISTS, RO_IDLE_ITEM_RULES, roIdleApplyItems(), roIdleItemList(), roIdleItemRow(), roIdleItemsFor(), roIdlePickItems() (+3 more)

### Community 34 - "items_characters"
Cohesion: 0.25
Nodes (8): get_groups(), goals_path(), items_characters(), load_map(), save_map(), set_goal(), set_groups(), valid_groups()

### Community 35 - "run"
Cohesion: 0.14
Nodes (20): auto_offline_tick(), enter_character(), hide_panel(), hide_panel_window(), install_update(), open_atlas(), open_classes(), open_guide() (+12 more)

### Community 36 - "run"
Cohesion: 0.22
Nodes (12): check_update(), load_panel_geometry(), notify(), panel_geometry_path(), PanelGeom, PanelLayout, PanelWidth, PendingUpdate (+4 more)

### Community 37 - "character_report"
Cohesion: 0.29
Nodes (6): character_report(), job_name(), place_panel(), restore_panel(), set_panel_width(), toast()

### Community 38 - "open_profile"
Cohesion: 0.15
Nodes (16): add_account(), add_profile(), confirm_remove(), dialog(), export_dir(), export_path(), open_account(), open_export_folder() (+8 more)

### Community 46 - "set_nickname"
Cohesion: 0.33
Nodes (6): load_nicknames(), load_profile_ids(), nicknames_path(), parse_ids(), set_nickname(), update_title()

## Knowledge Gaps
- **4 isolated node(s):** `@tauri-apps/cli`, `ro-idle-tray`, `Text`, `Tool`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 286 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ContextBudget` connect `.on_dispatch` to `chat.rs`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `@tauri-apps/cli`, `ro-idle-tray`, `Text` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.07899159663865546 - nodes in this community are weakly interconnected._
- **Why does `AiConfig` connect `ai.rs` to `chat.rs`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06394230769230769 - nodes in this community are weakly interconnected._
- **Why does `Element` connect `Element` to `bubble.test.mjs`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Should `tauri.conf.json` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._