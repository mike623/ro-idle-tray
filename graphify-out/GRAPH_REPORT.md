# Graph Report - ro-idle-tray  (2026-11-05)

## Corpus Check
- 62 files · ~96,995 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 2, .icns 1, .ico 1)

## Summary
- 849 nodes · 1667 edges · 59 communities (37 shown, 22 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `332fb6b0`
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
- bubble.test.mjs
- RO Idle Tray
- default.json
- Issue tracker: GitHub
- mcp.rs
- atlas-data.js
- ro-idle-tray
- secret.rs
- atlas.rs
- Domain Docs
- Agent skills
- scoped_agent
- triage-labels.md
- character_report
- formula-check.py
- alerts.rs
- app.json
- refresh
- items.js
- assistant.js
- run
- notify
- character_report
- run
- ref_node_assert
- items.test.mjs
- tutorial.test.mjs
- capture.test.mjs
- render
- items_characters
- knowledge.rs
- character_report
- chat_send
- extract-maps.test.mjs
- ref_node_vm
- capture.test.mjs
- chat_send
- window_scope
- .on_dispatch
- guide.rs

## God Nodes (most connected - your core abstractions)
1. `run()` - 20 edges
2. `window_scope()` - 18 edges
3. `chat_send()` - 16 edges
4. `respond()` - 15 edges
5. `card()` - 15 edges
6. `notify()` - 14 edges
7. `checks()` - 13 edges
8. `refresh()` - 13 edges
9. `ai_test_connection()` - 12 edges
10. `scoped_agent()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `clip()`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/ai.rs
- `agent()` --references--> `AiConfig`  [EXTRACTED]
  src-tauri/src/chat.rs → src-tauri/src/ai.rs
- `scoped_agent()` --references--> `AiConfig`  [EXTRACTED]
  src-tauri/src/chat.rs → src-tauri/src/ai.rs
- `refresh()` --calls--> `overview()`  [EXTRACTED]
  src/main.js → src/compact.js
- `refresh()` --calls--> `shown()`  [EXTRACTED]
  src/main.js → src/compact.js

## Import Cycles
- None detected.

## Communities (59 total, 22 thin omitted)

### Community 0 - "lib.rs"
Cohesion: 0.08
Nodes (22): AUTO_OFFLINE_AFTER, CHARACTER_HOOK, CharacterLabel, export_dir(), export_path(), get_state(), JOB_NAMES, LAUNCH_AGENT_LABEL (+14 more)

### Community 1 - "main.js"
Cohesion: 0.07
Nodes (57): attention(), overview(), shown(), after(), ago(), aiBusy(), aiChooseModel(), aiFill() (+49 more)

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
Cohesion: 0.07
Nodes (11): ChatLock, FALLBACK_CONTEXT_TOKENS, FORMAT, HISTORY_BYTES, MAX_TURNS, OUTPUT_TOKENS, panel_scope(), parse_starters() (+3 more)

### Community 6 - "api.rs"
Cohesion: 0.06
Nodes (48): ApiConfig, authorized(), BEARER, bind(), binds_loopback_and_serves_http(), character_events(), dedupes_replayed_events_by_seq(), DEFAULT_LIMIT (+40 more)

### Community 7 - "ai.rs"
Cohesion: 0.08
Nodes (37): ai_get_settings(), ai_list_models(), ai_save_settings(), ai_test_connection(), AiConfig, ANTHROPIC_VERSION, api_key(), caching_verdict() (+29 more)

### Community 8 - "package.json"
Cohesion: 0.20
Nodes (9): devDependencies, @tauri-apps/cli, name, private, scripts, tauri, type, version (+1 more)

### Community 9 - "remote.json"
Cohesion: 0.25
Nodes (7): description, identifier, permissions, remote, urls, $schema, windows

### Community 10 - "bubble.test.mjs"
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

### Community 19 - "secret.rs"
Cohesion: 0.11
Nodes (17): AI_FILE, file_path(), load(), load_named(), NONCE_LEN, rejects_tampered_or_unknown_blobs(), roundtrip_binds_to_the_machine(), SALT (+9 more)

### Community 20 - "atlas.rs"
Cohesion: 0.14
Nodes (27): all_in_play_are_selected_by_default(), apply_character(), apply_skills(), apply_stats(), assist_mode(), atlas_characters(), is_atlas(), items_apply() (+19 more)

### Community 21 - "Domain Docs"
Cohesion: 0.33
Nodes (5): Before exploring, read these, Domain Docs, File structure, Flag ADR conflicts, Use the glossary's vocabulary

### Community 22 - "Agent skills"
Cohesion: 0.40
Nodes (4): Agent skills, Domain docs, Issue tracker, Triage labels

### Community 23 - "scoped_agent"
Cohesion: 0.22
Nodes (13): chat_plan(), chat_plan_set(), load_plan(), mentioned_context(), mentions(), Plan, plan_accepts_known_pages_dedupes_and_limits(), plan_path() (+5 more)

### Community 25 - "character_report"
Cohesion: 0.33
Nodes (6): load_nicknames(), load_profile_ids(), nicknames_path(), parse_ids(), set_nickname(), update_title()

### Community 26 - "formula-check.py"
Cohesion: 0.11
Nodes (12): atk(), bonuses(), captures(), checks(), equipped(), formula_inventory(), Literal, main() (+4 more)

### Community 27 - "alerts.rs"
Cohesion: 0.10
Nodes (32): acknowledge(), Alert, Alerts, badge(), death_stop_and_supply_halt_are_unique_with_log_causes(), event_text(), ingest(), load() (+24 more)

### Community 33 - "items.js"
Cohesion: 0.26
Nodes (11): RO_IDLE_ITEM_KEYS, RO_IDLE_ITEM_LISTS, RO_IDLE_ITEM_RULES, roIdleApplyItems(), roIdleItemList(), roIdleItemRow(), roIdleItemsFor(), roIdlePickItems() (+3 more)

### Community 34 - "assistant.js"
Cohesion: 0.40
Nodes (5): ask(), assistant, names, pending, roster()

### Community 35 - "run"
Cohesion: 0.15
Nodes (17): enter_character(), hide_panel(), hide_panel_window(), install_update(), load_panel_geometry(), open_atlas(), open_classes(), open_guide() (+9 more)

### Community 36 - "notify"
Cohesion: 0.32
Nodes (8): add_account(), add_profile(), check_update(), notify(), profile_store_id(), remove_profile(), reorder_profiles(), save_profile_ids()

### Community 37 - "character_report"
Cohesion: 0.40
Nodes (5): place_panel(), restore_panel(), set_panel_width(), show_panel(), toggle_panel()

### Community 38 - "run"
Cohesion: 0.18
Nodes (14): auto_offline_tick(), caffeinated(), open_account(), open_items(), open_profile(), PanelLayout, PanelWidth, PendingUpdate (+6 more)

### Community 43 - "capture.test.mjs"
Cohesion: 0.25
Nodes (6): Formula evidence for the offline backend, Capture gap report (#12), Commands (#12 checklist, one character), Covered, Missing, Next captures (targeted, short)

### Community 46 - "items_characters"
Cohesion: 0.25
Nodes (8): get_groups(), goals_path(), items_characters(), load_map(), save_map(), set_goal(), set_groups(), valid_groups()

### Community 47 - "knowledge.rs"
Cohesion: 0.38
Nodes (8): DATA, live_game_lookup_contains_spore_sleep_water_and_attack(), lookup(), lookup_in(), map_monsters(), rank(), rank_in(), ranking_flags_aggressive_damage_and_respects_level_limit_and_bonus()

### Community 48 - "character_report"
Cohesion: 0.29
Nodes (7): character_report(), confirm_remove(), dialog(), job_name(), profile_number(), remove_account(), toast()

### Community 49 - "chat_send"
Cohesion: 0.16
Nodes (21): agent(), AlertView, anthropic_stream_and_model_written_compaction_work(), append(), archive(), character_threads_are_isolated_and_cannot_escape_chat_directory(), chat_survives_reload_and_new_chat_preserves_archive(), compact() (+13 more)

### Community 61 - "chat_send"
Cohesion: 0.17
Nodes (12): character_chat_cannot_read_other_characters_even_when_model_requests_them(), chat_send(), ChatEvent, Text, Tool, context_budget_reserves_output_and_handles_small_models(), ContextBudget, data_tools() (+4 more)

### Community 62 - "window_scope"
Cohesion: 0.32
Nodes (15): chat_alert_ack(), chat_alert_open(), chat_alerts(), chat_character(), chat_history(), chat_memory(), chat_new(), chat_starters() (+7 more)

### Community 66 - "guide.rs"
Cohesion: 0.12
Nodes (16): article_text(), BASE, BUDGET, cached(), decode(), excerpt(), fetch(), live_guide_fetches_index_and_a_page() (+8 more)

## Knowledge Gaps
- **4 isolated node(s):** `@tauri-apps/cli`, `ro-idle-tray`, `Text`, `Tool`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 317 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ContextBudget` connect `chat_send` to `chat_send`, `chat.rs`, `.on_dispatch`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `@tauri-apps/cli`, `ro-idle-tray`, `Text` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.07539118065433854 - nodes in this community are weakly interconnected._
- **Why does `AiConfig` connect `ai.rs` to `chat_send`, `chat_send`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06885245901639345 - nodes in this community are weakly interconnected._
- **Should `tauri.conf.json` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `extract-maps.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10952380952380952 - nodes in this community are weakly interconnected._