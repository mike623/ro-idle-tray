# Graph Report - UI-simulation  (2026-11-04)

## Corpus Check
- 66 files · ~105,647 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 3, .icns 1, .ico 1)

## Summary
- 927 nodes · 1794 edges · 61 communities (38 shown, 23 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1cdf18c7`
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
- guide.rs
- atlas.rs
- Domain Docs
- Agent skills
- battle.js
- triage-labels.md
- secret.rs
- formula-check.py
- alerts.rs
- app.json
- refresh
- items.js
- assistant.js
- run
- notify
- character_report
- open_profile
- ref_node_assert
- items.test.mjs
- tutorial.test.mjs
- extract-maps.test.mjs
- capture.test.mjs
- render
- run
- tutorial.rs
- Capture gap report (#12)
- refreshParty
- battle.js
- render
- refreshParty
- build
- Value
- json
- skills.test.mjs
- drawDigits
- listen

## God Nodes (most connected - your core abstractions)
1. `run()` - 20 edges
2. `render()` - 19 edges
3. `window_scope()` - 17 edges
4. `chat_send()` - 16 edges
5. `respond()` - 15 edges
6. `card()` - 15 edges
7. `notify()` - 14 edges
8. `checks()` - 13 edges
9. `refresh()` - 13 edges
10. `ai_test_connection()` - 12 edges

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

## Communities (61 total, 23 thin omitted)

### Community 0 - "lib.rs"
Cohesion: 0.08
Nodes (18): AUTO_OFFLINE_AFTER, CHARACTER_HOOK, CharacterLabel, get_state(), JOB_NAMES, LAUNCH_AGENT_LABEL, launch_agent_path(), PanelState (+10 more)

### Community 1 - "main.js"
Cohesion: 0.07
Nodes (56): attention(), overview(), shown(), after(), ago(), aiBusy(), aiChooseModel(), aiFill() (+48 more)

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
Nodes (72): agent(), AlertView, anthropic_stream_and_model_written_compaction_work(), append(), archive(), character_chat_cannot_read_other_characters_even_when_model_requests_them(), character_threads_are_isolated_and_cannot_escape_chat_directory(), chat_alert_ack() (+64 more)

### Community 6 - "api.rs"
Cohesion: 0.06
Nodes (48): ApiConfig, authorized(), BEARER, bind(), binds_loopback_and_serves_http(), character_events(), dedupes_replayed_events_by_seq(), DEFAULT_LIMIT (+40 more)

### Community 7 - "ai.rs"
Cohesion: 0.08
Nodes (34): ai_get_settings(), ai_list_models(), ai_save_settings(), ai_test_connection(), AiConfig, ANTHROPIC_VERSION, api_key(), caching_verdict() (+26 more)

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
Cohesion: 0.12
Nodes (16): article_text(), BASE, BUDGET, cached(), decode(), excerpt(), fetch(), live_guide_fetches_index_and_a_page() (+8 more)

### Community 20 - "atlas.rs"
Cohesion: 0.15
Nodes (26): all_in_play_are_selected_by_default(), apply_character(), apply_skills(), apply_stats(), assist_mode(), atlas_characters(), is_atlas(), items_apply() (+18 more)

### Community 21 - "Domain Docs"
Cohesion: 0.33
Nodes (5): Before exploring, read these, Domain Docs, File structure, Flag ADR conflicts, Use the glossary's vocabulary

### Community 22 - "Agent skills"
Cohesion: 0.40
Nodes (4): Agent skills, Domain docs, Issue tracker, Triage labels

### Community 23 - "battle.js"
Cohesion: 0.25
Nodes (4): environment(), window, source, tick()

### Community 25 - "secret.rs"
Cohesion: 0.06
Nodes (29): asset(), battle_backfill(), battle_party(), cache_file(), MIRRORS, open_battle(), protocol(), remote_url() (+21 more)

### Community 26 - "formula-check.py"
Cohesion: 0.11
Nodes (12): atk(), bonuses(), captures(), checks(), equipped(), formula_inventory(), Literal, main() (+4 more)

### Community 27 - "alerts.rs"
Cohesion: 0.15
Nodes (24): acknowledge(), Alert, Alerts, badge(), death_stop_and_supply_halt_are_unique_with_log_causes(), event_text(), ingest(), load() (+16 more)

### Community 33 - "items.js"
Cohesion: 0.26
Nodes (11): RO_IDLE_ITEM_KEYS, RO_IDLE_ITEM_LISTS, RO_IDLE_ITEM_RULES, roIdleApplyItems(), roIdleItemList(), roIdleItemRow(), roIdleItemsFor(), roIdlePickItems() (+3 more)

### Community 34 - "assistant.js"
Cohesion: 0.40
Nodes (5): ask(), assistant, names, pending, roster()

### Community 35 - "run"
Cohesion: 0.15
Nodes (17): enter_character(), install_update(), load_panel_geometry(), open_atlas(), open_classes(), open_guide(), open_items(), panel_geometry_path() (+9 more)

### Community 36 - "notify"
Cohesion: 0.40
Nodes (6): add_account(), add_profile(), check_update(), notify(), reorder_profiles(), save_profile_ids()

### Community 37 - "character_report"
Cohesion: 0.29
Nodes (7): hide_panel(), hide_panel_window(), place_panel(), restore_panel(), set_panel_width(), show_panel(), toggle_panel()

### Community 38 - "open_profile"
Cohesion: 0.14
Nodes (18): auto_offline_tick(), caffeinated(), confirm_remove(), dialog(), export_dir(), export_path(), open_account(), open_export_folder() (+10 more)

### Community 46 - "run"
Cohesion: 0.21
Nodes (11): goals_path(), items_characters(), load_map(), load_nicknames(), nicknames_path(), PanelLayout, PanelWidth, PendingUpdate (+3 more)

### Community 47 - "tutorial.rs"
Cohesion: 0.16
Nodes (16): DATA, live_game_lookup_contains_spore_sleep_water_and_attack(), lookup(), lookup_in(), map_monsters(), rank(), rank_in(), ranking_flags_aggressive_damage_and_respects_level_limit_and_bonus() (+8 more)

### Community 48 - "Capture gap report (#12)"
Cohesion: 0.40
Nodes (5): Capture gap report (#12), Commands (#12 checklist, one character), Covered, Missing, Next captures (targeted, short)

### Community 49 - "refreshParty"
Cohesion: 0.29
Nodes (7): character_report(), job_name(), load_profile_ids(), parse_ids(), set_nickname(), toast(), update_title()

### Community 51 - "battle.js"
Cohesion: 0.06
Nodes (31): atl, ATLASES, encounters, fx, ground, ITEMS, JOB_ID, last (+23 more)

### Community 52 - "render"
Cohesion: 0.18
Nodes (13): bracket(), drawAtlas(), drawStr(), ev(), lastBefore(), lo(), look(), lureOff() (+5 more)

### Community 53 - "refreshParty"
Cohesion: 0.25
Nodes (7): addBackfill(), addEvents(), esc(), invoke(), refreshParty(), setParty(), stats()

### Community 54 - "build"
Cohesion: 0.29
Nodes (7): build(), fighting(), live(), liveEdge(), loop(), marchingAt(), mk()

### Community 55 - "Value"
Cohesion: 0.50
Nodes (4): battle_roster(), get_groups(), set_groups(), valid_groups()

### Community 56 - "json"
Cohesion: 0.67
Nodes (4): json(), load(), loadAtlas(), loadStr()

## Knowledge Gaps
- **4 isolated node(s):** `@tauri-apps/cli`, `ro-idle-tray`, `Text`, `Tool`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 348 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Element` connect `bubble.test.mjs` to `refreshParty`, `battle.js`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **What connects `@tauri-apps/cli`, `ro-idle-tray`, `Text` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lib.rs` be split into smaller, more focused modules?**
  _Cohesion score 0.08199643493761141 - nodes in this community are weakly interconnected._
- **Why does `refreshParty()` connect `refreshParty` to `json`, `battle.js`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Should `main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07005649717514124 - nodes in this community are weakly interconnected._
- **Should `tauri.conf.json` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `extract-maps.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10952380952380952 - nodes in this community are weakly interconnected._