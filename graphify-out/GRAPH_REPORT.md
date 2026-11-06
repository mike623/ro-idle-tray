# Graph Report - ro-idle-tray  (2026-11-06)

## Corpus Check
- 65 files · ~526,959 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 2, .icns 1, .ico 1)

## Summary
- 881 nodes · 1708 edges · 58 communities (37 shown, 21 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `28254eb8`
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
- memory.rs
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
- run
- formula-check.py
- alerts.rs
- app.json
- refresh
- items.js
- assistant.js
- run
- write_panel_geometry
- character_report
- open_profile
- ref_node_assert
- items.test.mjs
- tutorial.test.mjs
- ChatEvent
- capture.test.mjs
- render
- CharacterLabel
- chat_send
- record.mjs
- capture.test.mjs
- agent
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
- `Demo recordings` --references--> `main()`  [INFERRED]
  README.md → scripts/formula-check.py
- `示範動畫` --references--> `main()`  [INFERRED]
  README.zh-TW.md → scripts/formula-check.py
- `Formula evidence for the offline backend` --references--> `hide()`  [INFERRED]
  docs/offline-backend/formulas.md → e2e/mock-tauri.js
- `run()` --calls--> `clip()`  [INFERRED]
  src-tauri/src/lib.rs → src-tauri/src/ai.rs
- `agent()` --references--> `AiConfig`  [EXTRACTED]
  src-tauri/src/chat.rs → src-tauri/src/ai.rs

## Import Cycles
- None detected.

## Communities (58 total, 21 thin omitted)

### Community 0 - "lib.rs"
Cohesion: 0.07
Nodes (15): AUTO_OFFLINE_AFTER, CHARACTER_HOOK, export_dir(), export_path(), JOB_NAMES, LAUNCH_AGENT_LABEL, open_export_folder(), open_exports() (+7 more)

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
Cohesion: 0.06
Nodes (13): ChatLock, FALLBACK_CONTEXT_TOKENS, FORMAT, HISTORY_BYTES, MAX_TURNS, OUTPUT_TOKENS, panel_scope(), parse_starters() (+5 more)

### Community 6 - "api.rs"
Cohesion: 0.07
Nodes (48): ApiConfig, authorized(), BEARER, bind(), binds_loopback_and_serves_http(), character_events(), dedupes_replayed_events_by_seq(), DEFAULT_LIMIT (+40 more)

### Community 7 - "ai.rs"
Cohesion: 0.08
Nodes (37): ai_get_settings(), ai_list_models(), ai_save_settings(), ai_test_connection(), AiConfig, ANTHROPIC_VERSION, api_key(), caching_verdict() (+29 more)

### Community 8 - "package.json"
Cohesion: 0.17
Nodes (11): devDependencies, playwright, @tauri-apps/cli, name, private, scripts, tauri, type (+3 more)

### Community 9 - "remote.json"
Cohesion: 0.25
Nodes (7): description, identifier, permissions, remote, urls, $schema, windows

### Community 10 - "bubble.test.mjs"
Cohesion: 0.12
Nodes (5): Element, environment(), window, source, tick()

### Community 11 - "memory.rs"
Cohesion: 0.34
Nodes (12): context(), edit(), footer(), index(), known(), MAX_BYTES, names(), note() (+4 more)

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
Cohesion: 0.12
Nodes (17): AI_FILE, file_path(), load(), load_named(), NONCE_LEN, rejects_tampered_or_unknown_blobs(), roundtrip_binds_to_the_machine(), SALT (+9 more)

### Community 20 - "atlas.rs"
Cohesion: 0.12
Nodes (27): all_in_play_are_selected_by_default(), apply_character(), apply_skills(), apply_stats(), assist_mode(), atlas_characters(), is_atlas(), items_apply() (+19 more)

### Community 21 - "Domain Docs"
Cohesion: 0.33
Nodes (5): Before exploring, read these, Domain Docs, File structure, Flag ADR conflicts, Use the glossary's vocabulary

### Community 22 - "Agent skills"
Cohesion: 0.40
Nodes (4): Agent skills, Domain docs, Issue tracker, Triage labels

### Community 23 - "scoped_agent"
Cohesion: 0.21
Nodes (13): character_chat_cannot_read_other_characters_even_when_model_requests_them(), data_tools(), load_plan(), mentioned_context(), mentions(), Plan, plan_path(), plan_preamble() (+5 more)

### Community 25 - "run"
Cohesion: 0.18
Nodes (17): character_report(), check_update(), goals_path(), items_characters(), job_name(), load_map(), load_nicknames(), load_profile_ids() (+9 more)

### Community 26 - "formula-check.py"
Cohesion: 0.06
Nodes (28): Demo recordings, Development, Features, Install, Project layout, References, Release, RO Idle Tray (+20 more)

### Community 27 - "alerts.rs"
Cohesion: 0.10
Nodes (28): acknowledge(), Alert, Alerts, badge(), death_stop_and_supply_halt_are_unique_with_log_causes(), event_text(), ingest(), load() (+20 more)

### Community 33 - "items.js"
Cohesion: 0.26
Nodes (11): RO_IDLE_ITEM_KEYS, RO_IDLE_ITEM_LISTS, RO_IDLE_ITEM_RULES, roIdleApplyItems(), roIdleItemList(), roIdleItemRow(), roIdleItemsFor(), roIdlePickItems() (+3 more)

### Community 34 - "assistant.js"
Cohesion: 0.40
Nodes (5): ask(), assistant, names, pending, roster()

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
Cohesion: 0.19
Nodes (14): auto_offline_tick(), caffeinated(), confirm_remove(), dialog(), open_account(), open_profile(), poll_profiles(), profile_number() (+6 more)

### Community 42 - "ChatEvent"
Cohesion: 0.67
Nodes (3): ChatEvent, Text, Tool

### Community 43 - "capture.test.mjs"
Cohesion: 0.17
Nodes (8): Formula evidence for the offline backend, Capture gap report (#12), Commands (#12 checklist, one character), Covered, Missing, Next captures (targeted, short), Channel, hide()

### Community 46 - "CharacterLabel"
Cohesion: 0.18
Nodes (12): CharacterLabel, get_groups(), get_state(), launch_agent_path(), PanelState, ProfileView, set_autostart(), set_groups() (+4 more)

### Community 49 - "chat_send"
Cohesion: 0.24
Nodes (19): AlertView, append(), archive(), character_threads_are_isolated_and_cannot_escape_chat_directory(), chat_alert_open(), chat_history(), chat_send(), chat_survives_reload_and_new_chat_preserves_archive() (+11 more)

### Community 51 - "record.mjs"
Cohesion: 0.13
Nodes (11): click(), only, OUT, pause(), point(), SCENES, server, TMP (+3 more)

### Community 61 - "agent"
Cohesion: 0.22
Nodes (9): agent(), anthropic_stream_and_model_written_compaction_work(), context_budget_reserves_output_and_handles_small_models(), context_guard_stops_oversized_requests_before_network(), ContextBudget, detected_context_budget_allows_requests_above_old_limit(), fixture_server(), openai_stream_executes_tool_and_preserves_replayable_transcript() (+1 more)

### Community 62 - "window_scope"
Cohesion: 0.33
Nodes (15): chat_alert_ack(), chat_alerts(), chat_character(), chat_memory(), chat_new(), chat_plan(), chat_plan_set(), chat_starters() (+7 more)

### Community 66 - "guide.rs"
Cohesion: 0.12
Nodes (16): article_text(), BASE, BUDGET, cached(), decode(), excerpt(), fetch(), live_guide_fetches_index_and_a_page() (+8 more)

## Knowledge Gaps
- **4 isolated node(s):** `@tauri-apps/cli`, `ro-idle-tray`, `Text`, `Tool`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 330 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `@tauri-apps/cli`, `ro-idle-tray`, `Text` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.0748663101604278 - nodes in this community are weakly interconnected._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06885245901639345 - nodes in this community are weakly interconnected._
- **Should `tauri.conf.json` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `extract-maps.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10952380952380952 - nodes in this community are weakly interconnected._
- **Should `chat.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `api.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.06504494976203067 - nodes in this community are weakly interconnected._