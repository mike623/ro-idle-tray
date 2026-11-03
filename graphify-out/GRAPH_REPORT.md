# Graph Report - ro-idle-tray  (2026-11-03)

## Corpus Check
- 49 files · ~70,930 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 2, .icns 1, .ico 1)

## Summary
- 699 nodes · 1370 edges · 40 communities (29 shown, 11 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7f93fec9`
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
- alerts.rs
- atlas.rs
- Domain Docs
- Agent skills
- memory.rs
- triage-labels.md
- secret.rs
- chat.js
- .on_dispatch
- app.json
- refresh
- items.js
- AppHandle
- run
- notify
- toggle_panel
- write_panel_geometry
- open_exports

## God Nodes (most connected - your core abstractions)
1. `run()` - 20 edges
2. `respond()` - 15 edges
3. `chat_send()` - 15 edges
4. `notify()` - 14 edges
5. `card()` - 14 edges
6. `window_scope()` - 13 edges
7. `ai_test_connection()` - 12 edges
8. `row()` - 11 edges
9. `open_profile()` - 11 edges
10. `ai_save_settings()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `clip()`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/ai.rs
- `job_name()` --calls--> `lookup()`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/knowledge.rs
- `agent()` --references--> `AiConfig`  [EXTRACTED]
  src-tauri/src/chat.rs → src-tauri/src/ai.rs
- `scoped_agent()` --references--> `AiConfig`  [EXTRACTED]
  src-tauri/src/chat.rs → src-tauri/src/ai.rs
- `show()` --calls--> `showPanel()`  [EXTRACTED]
  src/chat.js → src/panel.js

## Import Cycles
- None detected.

## Communities (40 total, 11 thin omitted)

### Community 0 - "lib.rs"
Cohesion: 0.08
Nodes (17): CHARACTER_HOOK, CharacterLabel, get_state(), JOB_NAMES, LAUNCH_AGENT_LABEL, launch_agent_path(), PanelState, PanelWidth (+9 more)

### Community 1 - "main.js"
Cohesion: 0.08
Nodes (48): ago(), aiBusy(), aiChooseModel(), aiFill(), aiHighlightModel(), aiLoad(), aiLoadModels(), aiModelCandidates() (+40 more)

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
Cohesion: 0.08
Nodes (47): agent(), AlertView, anthropic_stream_and_model_written_compaction_work(), append(), archive(), character_chat_cannot_read_other_characters_even_when_model_requests_them(), character_threads_are_isolated_and_cannot_escape_chat_directory(), chat_alert_ack() (+39 more)

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

### Community 10 - "Element"
Cohesion: 0.05
Nodes (11): Element, environment(), window, source, source, arrows, snapshot, get() (+3 more)

### Community 11 - "RO Idle Tray"
Cohesion: 0.33
Nodes (5): Build, Install, Release, RO Idle Tray, Run

### Community 12 - "default.json"
Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 13 - "Issue tracker: GitHub"
Cohesion: 0.29
Nodes (6): Conventions, Issue tracker: GitHub, Pull requests as a triage surface, Wayfinding operations, When a skill says "fetch the relevant ticket", When a skill says "publish to the issue tracker"

### Community 14 - "mcp.rs"
Cohesion: 0.09
Nodes (14): ALLOWED, CALL_TIMEOUT, CONNECT_TIMEOUT, ENDPOINT, failure(), MAX_RESULT_BYTES, raw_text(), reaches_the_hosted_server() (+6 more)

### Community 19 - "alerts.rs"
Cohesion: 0.10
Nodes (27): acknowledge(), Alert, Alerts, badge(), death_stop_and_supply_halt_are_unique_with_log_causes(), event_text(), ingest(), load() (+19 more)

### Community 20 - "atlas.rs"
Cohesion: 0.16
Nodes (22): all_in_play_are_selected_by_default(), atlas_characters(), is_atlas(), items_apply(), items_file(), items_merge(), items_read(), items_save() (+14 more)

### Community 21 - "Domain Docs"
Cohesion: 0.33
Nodes (5): Before exploring, read these, Domain Docs, File structure, Flag ADR conflicts, Use the glossary's vocabulary

### Community 22 - "Agent skills"
Cohesion: 0.40
Nodes (4): Agent skills, Domain docs, Issue tracker, Triage labels

### Community 23 - "memory.rs"
Cohesion: 0.34
Nodes (12): context(), edit(), footer(), index(), known(), MAX_BYTES, names(), note() (+4 more)

### Community 25 - "secret.rs"
Cohesion: 0.11
Nodes (17): AI_FILE, file_path(), load(), load_named(), NONCE_LEN, rejects_tampered_or_unknown_blobs(), roundtrip_binds_to_the_machine(), SALT (+9 more)

### Community 26 - "chat.js"
Cohesion: 0.26
Nodes (11): card(), characters, error(), memory(), mentions, node(), render(), roster() (+3 more)

### Community 33 - "items.js"
Cohesion: 0.31
Nodes (10): RO_IDLE_ITEM_KEYS, RO_IDLE_ITEM_LISTS, RO_IDLE_ITEM_RULES, roIdleApplyItems(), roIdleItemList(), roIdleItemRow(), roIdleItemsFor(), roIdlePickItems() (+2 more)

### Community 34 - "AppHandle"
Cohesion: 0.13
Nodes (18): add_account(), add_profile(), enter_character(), get_groups(), install_update(), load_nicknames(), nicknames_path(), open_atlas() (+10 more)

### Community 35 - "run"
Cohesion: 0.20
Nodes (15): confirm_remove(), dialog(), load_map(), load_offline(), load_profile_ids(), open_account(), open_profile(), parse_ids() (+7 more)

### Community 36 - "notify"
Cohesion: 0.22
Nodes (10): character_report(), check_update(), goals_path(), job_name(), notify(), save_map(), set_goal(), set_nickname() (+2 more)

### Community 37 - "toggle_panel"
Cohesion: 0.29
Nodes (7): hide_panel(), hide_panel_window(), place_panel(), poll_profiles(), restore_panel(), set_panel_width(), toggle_panel()

### Community 38 - "write_panel_geometry"
Cohesion: 0.33
Nodes (7): load_panel_geometry(), panel_geometry_path(), PanelGeom, PanelLayout, save_panel_geometry(), set_pinned(), write_panel_geometry()

### Community 39 - "open_exports"
Cohesion: 0.50
Nodes (4): export_dir(), export_path(), open_export_folder(), open_exports()

## Knowledge Gaps
- **4 isolated node(s):** `@tauri-apps/cli`, `ro-idle-tray`, `Text`, `Tool`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 259 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ContextBudget` connect `.on_dispatch` to `chat.rs`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `@tauri-apps/cli`, `ro-idle-tray`, `Text` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.08253968253968254 - nodes in this community are weakly interconnected._
- **Why does `AiConfig` connect `ai.rs` to `chat.rs`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08220211161387632 - nodes in this community are weakly interconnected._
- **Why does `job_name()` connect `notify` to `lib.rs`, `alerts.rs`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Should `tauri.conf.json` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._