mod api;
mod tutorial;
mod alerts;
mod memory;
mod storage;
mod knowledge;
mod guide;
mod atlas;
mod chat;
mod ai;
mod secret;
mod mcp;
#[cfg(target_os = "macos")]
mod js_dialogs;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder,
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_positioner::WindowExt;
use tauri_plugin_updater::{Update, UpdaterExt};

// Runs before the game bundle. The game calls global fetch for
// GET /api/characters/{id}?deferCatchup=1 and opens a global EventSource on
// /api/characters/{id}/stream whose `snapshot` events carry live levels. Both
// payloads hold the snapshot (character, derived, activity) the game's own
// 角色 info box renders. POST /commands replies carry it too (view.snapshot).
const CHARACTER_HOOK: &str = r#"
(() => {
  // The game closes its live stream 5s after the page goes hidden. Always report
  // "visible" so every window keeps streaming snapshots and battle-log events.
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  // Auto-accept the game's "遊戲已更新" banner/toast by clicking its 重新整理 button
  // (idle progress lives on the server). At most once per 10 min so a stale CDN can't loop.
  setInterval(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '重新整理'
      && (b.parentElement?.parentElement ?? b.parentElement)?.textContent.includes('遊戲已更新'));
    if (!btn) return;
    const last = Number(sessionStorage.getItem('roIdleAutoReload') || 0);
    if (Date.now() - last < 600000) return;
    sessionStorage.setItem('roIdleAutoReload', String(Date.now()));
    btn.click();
  }, 30000);
  let last = '', lastAt = 0, streamId = null, liveES = null, streamAt = 0, bootAt = Date.now();
  const cache = {};
  const num = v => Number.isFinite(v) ? v : null;
  // Map and action names come from tables inside the game bundle, so read the
  // game's own rendered 地點與戰況 rows (<span>地圖</span><b>name</b>).
  const domText = label => {
    const el = [...document.querySelectorAll('span')].find(e => e.textContent === label);
    return el?.nextElementSibling?.textContent?.trim() || null;
  };
  // Sent straight away: hidden pages run timers seconds late. ponytail: map/action
  // DOM text may lag one snapshot (~3s) behind; fine for a tray label.
  const send = s => flush(s);
  const flush = s => {
    const c = s?.character, d = s?.derived || {};
    if (!c || typeof c.name !== 'string' || !Number.isInteger(c.baseLv) || !Number.isInteger(c.jobLv)) return;
    const running = typeof s.activity === 'string' ? s.activity !== 'stopped' : null;
    const payload = {
      profile: RO_IDLE_PROFILE, name: c.name, class: typeof c.job === 'string' ? c.job : '',
      base: c.baseLv, job: c.jobLv, points: Number.isInteger(c.statPoints) ? c.statPoints : 0,
      baseExp: num(c.baseExp), baseExpNext: num(s.baseExpNext), jobExp: num(c.jobExp), jobExpNext: num(s.jobExpNext),
      hp: num(c.hp), maxHp: num(d.maxHp), sp: num(c.sp), maxSp: num(d.maxSp),
      weight: num(s.weight), weightMax: num(d.weightMax), zeny: num(c.zeny),
      running, stopping: running === true && s.pendingStop != null,
      map: domText('地圖') ?? (typeof s.mapId === 'string' ? s.mapId : null),
      action: domText('行動'),
      assist: !!assistMap(), assistNote,
      // Base stats + the 自動配點 plan, so the chat agent can suggest absolute targets.
      stats: c.stats && typeof c.stats === 'object' ? c.stats : null,
      statsAuto: s.config?.statsAddAuto?.enabled ? s.config.statsAddAuto.list ?? [] : null,
      // Learned skills {AL_HEAL: 9, ...}, unspent skill points and the auto-skill setup.
      skills: c.skills && typeof c.skills === 'object' ? c.skills : null,
      skillPoints: Number.isInteger(c.skillPoints) ? c.skillPoints : 0,
      skillSetup: Array.isArray(s.config?.skills) ? s.config.skills : null,
      target: s.target && typeof s.target.name === 'string'
        ? { name: s.target.name, lv: num(s.target.lv), hp: num(s.target.hp), maxHp: num(s.target.maxHp) } : null,
    };
    window.dispatchEvent(new CustomEvent("ro-idle-chat-state", {detail: payload}));
    autoAssist(s);
    const key = JSON.stringify(payload);
    // Remember the character in play (per-profile storage) so auto-enter picks it next launch.
    try { localStorage.setItem('roIdleTray.lastCharacter', c.name); } catch {}
    // Re-send unchanged data after 20s so the panel's "updated" time stays honest.
    if (key === last && Date.now() - lastAt < 20000) return;
    last = key;
    lastAt = Date.now();
    console.info('[ro-idle-tray] character', payload);
    window.__TAURI_INTERNALS__?.invoke('character_report', { data: payload })
      .catch(e => console.warn('[ro-idle-tray] emit failed', e));
  };
  const origFetch = window.fetch;
  window.fetch = function (input) {
    const p = origFetch.apply(this, arguments);
    const url = String(input?.url ?? input);
    const id = (url.match(/\/api\/characters\/([^/?]+)(?:\?deferCatchup|\/commands$)/) || [])[1];
    if (id) p.then(r => r.ok ? r.clone().json() : null).then(d => {
      const snap = d?.snapshot ?? d?.view?.snapshot;
      if (!snap?.character) return;
      cache[id] = snap;
      // ponytail: other-character previews hit the same URL; only trust the streamed one.
      if (streamId === null || streamId === id) send(snap);
    }).catch(() => {});
    return p;
  };
  const OrigES = window.EventSource;
  window.EventSource = class extends OrigES {
    constructor(url, opts) {
      super(url, opts);
      const id = (String(url).match(/\/api\/characters\/([^/?]+)\/stream/) || [])[1];
      if (!id) return;
      streamId = id;
      liveES = this;
      streamAt = Date.now();
      this.addEventListener('message', () => { streamAt = Date.now(); });
      if (cache[id]) send(cache[id]);
      this.addEventListener('snapshot', e => {
        try {
          streamAt = Date.now();
          if (streamId === id) { const s = JSON.parse(e.data)?.snapshot; if (s?.character) { cache[id] = s; send(s); } }
        } catch {}
      });
      // Battle/log lines the game's log window shows; mirrored raw to logs/<profile>.log.
      this.addEventListener('events', e => {
        streamAt = Date.now();
        if (streamId !== id || typeof e.data !== 'string') return;
        window.__TAURI_INTERNALS__?.invoke('plugin:event|emit', { event: 'ro-idle-log', payload: { profile: RO_IDLE_PROFILE, data: e.data } })
          .catch(() => {});
      });
    }
  };
  // Hidden windows skip the game's own visible-only refresh and WebKit throttles
  // their timers, so Rust calls this on its own clock (see poll_profiles).
  window.__roIdlePoll = (hidden) => {
    // A hidden page that never opened a stream in 5 min is stuck loading (seen 2026-11-03
    // 14:06: 3 of 8 windows silent after All Online). Reload; hidden only, so a visible
    // login screen is never yanked away mid-typing.
    if (hidden && !liveES && Date.now() - bootAt > 5 * 60 * 1000) { location.reload(); return; }
    // The server sometimes drops every stream at once and the game never reopens it
    // (seen 2026-11-03 08:52); snapshots kept polling but battle logs went silent.
    // ponytail: a full reload is the one recovery known to work; 10 min silence also
    // catches a stopped character the server stops pushing to (one cheap reload each).
    if (liveES && (liveES.readyState === 2 || Date.now() - streamAt > 10 * 60 * 1000)) {
      liveES = null;
      location.reload();
      return;
    }
    if (streamId !== null) window.fetch(`/api/characters/${streamId}?deferCatchup=1`, { credentials: 'same-origin' }).catch(() => {});
  };
  window.__roIdleMove = async mapId => {
    const id = streamId;
    const snapshot = await roIdleMove(mapId, id, cache[id]);
    if (snapshot && streamId === id) { cache[id] = snapshot; send(snapshot); }
  };
  // Panel's Recall All: same command as the game's 回儲存點 button (skipped when dead, like the game).
  window.__roIdleRecall = async () => {
    const s = cache[streamId];
    if (s?.activity === 'dead') throw new Error('Dead');
    if (!s?.saveMap) throw new Error('No save point');
    await window.__roIdleMove(s.saveMap);
  };
  // Panel's Merge Items / Fan Out (see items.js).
  window.__roIdleItems = overrides => {
    const s = cache[streamId];
    if (!s?.config) throw new Error('No character currently in play');
    return {job: s.character?.job ?? '', items: roIdleSharedItems(s.config, overrides, s.character?.name)};
  };
  window.__roIdleApplyItems = async (items, overrides) => {
    const id = streamId;
    const snapshot = await roIdleApplyItems(id, cache[id], items, overrides);
    if (snapshot && streamId === id) { cache[id] = snapshot; send(snapshot); }
  };
  // Row menu's 輔助模式 toggle: every monster on the current map → 被打才還手, re-applied after each
  // map switch while on. byMap = {mapId: [monsterId]}, kept in this profile's storage; null = off.
  const ASSIST = 'roIdleTray.assist';
  let assistBusy = false, assistAt = 0, assistNote = null;
  function assistMap() { try { return JSON.parse(localStorage.getItem(ASSIST)); } catch { return null; } }
  function assistIds(s, byMap) {
    const ids = byMap?.[s?.mapId];
    const done = new Set((s?.config?.monsterRules ?? []).filter(r => r.action === 'defend').map(r => r.monsterId));
    return ids?.some(id => !done.has(id)) ? ids : null;
  }
  async function assistApply(id, s, ids) {
    try {
      const snapshot = await roIdleUpdateConfig(id, roIdleAssistConfig(s.config, ids));
      assistNote = `applied ${ids.length} on ${s.mapId}`;
      if (snapshot && streamId === id) { cache[id] = snapshot; send(snapshot); }
    } catch (e) { assistNote = `failed on ${s.mapId}: ${e.message || e}`; last = null; send(s); throw e; }
  }
  // Called on every snapshot. ponytail: one try per minute, so a refused update can't loop.
  function autoAssist(s) {
    const byMap = assistMap(), id = streamId, ids = s?.config && assistIds(s, byMap);
    if (!ids || assistBusy || id === null || Date.now() - assistAt < 60000) return;
    assistBusy = true; assistAt = Date.now();
    assistApply(id, s, ids).catch(e => console.warn('[ro-idle-tray] assist failed', e)).finally(() => { assistBusy = false; });
  }
  window.__roIdleAssist = async byMap => {
    const id = streamId, s = cache[id];
    if (!byMap) { localStorage.removeItem(ASSIST); last = null; if (s) send(s); return 0; }
    if (!s?.config) throw new Error('No character currently in play');
    localStorage.setItem(ASSIST, JSON.stringify(byMap));
    last = null;
    const ids = assistIds(s, byMap);
    if (ids) await assistApply(id, s, ids); else send(s);
    return byMap[s.mapId]?.length ?? 0;
  };
  // Chat's 套用到自動配點 button. rows = [{stat, n, add}]: add → current stat + n, else target n.
  // Suggested stats go first in the 自動配點 list; other existing rows are kept after them.
  window.__roIdleStatsAuto = async rows => {
    const id = streamId, s = cache[id];
    if (!s?.config) throw new Error('No character currently in play');
    const now = s.character?.stats ?? {};
    const list = rows.map(r => {
      if (r.add && !Number.isFinite(now[r.stat])) throw new Error('Current stats unknown');
      return {stat: r.stat, target: Math.min(99, Math.max(1, Math.round(r.add ? now[r.stat] + r.n : r.n)))};
    });
    const keep = (s.config.statsAddAuto?.list ?? []).filter(r => !list.some(x => x.stat === r.stat));
    const snapshot = await roIdleUpdateConfig(id, {...s.config, statsAddAuto: {enabled: true, list: [...list, ...keep]}});
    if (snapshot && streamId === id) { cache[id] = snapshot; send(snapshot); }
    return list;
  };
  // Called by the tray panel: press the game's own 開始掛機 / 停止掛機 button.
  window.__roIdleToggle = () => {
    const btn = [...document.querySelectorAll('button.xp-btn.primary')]
      .find(b => /停止掛機|開始掛機|停止中/.test(b.textContent));
    if (btn && !btn.disabled) btn.click();
    return !!btn;
  };
  // Character select screen: report its rows so the panel can list them.
  const rows = () => [...document.querySelectorAll('ul[aria-label="角色列表"] li')];
  // Name = direct text of the row's bold line (its <span> holds （掛機中）).
  // The game later put ▲▼ reorder buttons first in the row, so find the bold line instead of going by position.
  const rowHead = li => li.querySelector('.font-bold') ?? li.firstElementChild?.firstElementChild;
  const rowName = li => [...(rowHead(li)?.childNodes ?? [])]
    .filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  let lastRoster = '';
  const scanRoster = () => {
    // Row markup (game's character row): li > div > [div.font-bold "name" <span>（掛機中）</span>, div "盜賊 Lv.22 / Job 8・map", div? delete notice].
    const chars = rows().map(li => {
      const head = rowHead(li);
      if (!head) return null;
      const line = head.nextElementSibling, note = line?.nextElementSibling;
      const name = rowName(li);
      const status = [...head.querySelectorAll('span')].map(e => e.textContent.trim().replace(/^[(（]|[)）]$/g, '')).join(' ') || null;
      const detail = [line, note].filter(Boolean).map(e => e.textContent.trim()).join(' · ');
      return name ? { name, status, detail } : null;
    }).filter(Boolean);
    const key = JSON.stringify(chars);
    if (key === lastRoster) return;
    lastRoster = key;
    window.__TAURI_INTERNALS__?.invoke('plugin:event|emit', { event: 'ro-idle-roster', payload: { profile: RO_IDLE_PROFILE, chars } })
      .catch(() => {});
  };
  let rosterTimer = 0;
  const rosterObs = new MutationObserver(() => { clearTimeout(rosterTimer); rosterTimer = setTimeout(scanRoster, 300); });
  // Called by the tray panel: press 進入 on row i of the select screen.
  window.__roIdleEnter = i => {
    const btn = [...(rows()[i]?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === '進入');
    if (btn && !btn.disabled) btn.click();
  };
  // Auto-enter the first playable character once per page load (select screen
  // is a list `ul[aria-label="角色列表"]`, each row's primary button is 進入).
  let entered = false;
  const tryEnter = () => {
    if (entered) return;
    const enterBtn = li => [...li.querySelectorAll('button.xp-btn.primary')]
      .find(b => !b.disabled && b.textContent.trim() === '進入');
    const list = rows().filter(enterBtn);
    if (!list.length) return;
    let lastName = null;
    try { lastName = localStorage.getItem('roIdleTray.lastCharacter'); } catch {}
    // Last character played on this profile, else the first one. If the remembered one is
    // not found (renamed, deleted, or row markup changed), pick nothing rather than the wrong one.
    const li = lastName ? list.find(r => rowName(r) === lastName) : list[0];
    if (!li) { entered = true; obs.disconnect(); console.warn('[ro-idle-tray] auto-enter: no row named', lastName); return; }
    entered = true;
    obs.disconnect();
    console.info('[ro-idle-tray] auto-enter', rowName(li));
    enterBtn(li).click();
  };
  const obs = new MutationObserver(tryEnter);
  const start = () => {
    obs.observe(document.documentElement, { childList: true, subtree: true });
    rosterObs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    scanRoster();
    // ponytail: give up after 2 min so a later manual "switch character" isn't hijacked.
    setTimeout(() => { entered = true; obs.disconnect(); }, 120000);
    tryEnter();
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
"#;

struct Profiles {
    /// Profile numbers in display order (user-sortable); each maps to its own WebKit data store.
    ids: Mutex<Vec<u8>>,
    /// Latest character data per profile, shown in the tray panel.
    info: Mutex<HashMap<u8, CharacterLabel>>,
    /// Character select rows per profile; empty when not on that screen.
    roster: Mutex<HashMap<u8, Vec<RosterChar>>>,
    /// Own-reference nicknames keyed by character name (names are unique per server).
    nicknames: Mutex<HashMap<String, String>>,
    /// Final job each character is heading for (e.g. "超魔導師"), so the assistant knows the build direction.
    goals: Mutex<HashMap<String, String>>,
    /// Profiles switched to offline: no game window at all, so the server stops ticking them live.
    offline: Mutex<Vec<u8>>,
    /// Per profile: last time its game window was visible (or it came online).
    active_at: Mutex<HashMap<u8, std::time::Instant>>,
    /// Last hourly wake of offline profiles.
    woke_at: Mutex<std::time::Instant>,
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
struct RosterChar {
    name: String,
    status: Option<String>,
    detail: String,
}

#[derive(serde::Deserialize)]
struct Roster {
    profile: String,
    chars: Vec<RosterChar>,
}

/// Sent by CHARACTER_HOOK; mirrors the game's 角色 info box.
#[derive(serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CharacterLabel {
    #[serde(skip_serializing)]
    profile: String,
    name: String,
    #[serde(default)]
    class: String,
    base: u32,
    job: u32,
    /// Unspent stat points (the game's red 尚有 N 點屬性點可分配 notice).
    #[serde(default)]
    points: u32,
    base_exp: Option<f64>,
    base_exp_next: Option<f64>,
    job_exp: Option<f64>,
    job_exp_next: Option<f64>,
    hp: Option<f64>,
    max_hp: Option<f64>,
    sp: Option<f64>,
    max_sp: Option<f64>,
    weight: Option<f64>,
    weight_max: Option<f64>,
    zeny: Option<f64>,
    running: Option<bool>,
    #[serde(default)]
    stopping: bool,
    /// 輔助模式 on: current-map monsters kept at 被打才還手 across map switches.
    #[serde(default)]
    assist: bool,
    /// Last 輔助模式 apply result, for the dev log only.
    #[serde(default, skip_serializing)]
    assist_note: Option<String>,
    /// Base stats {str, agi, vit, int, dex, luk}.
    #[serde(default)]
    stats: Option<serde_json::Value>,
    /// 自動配點 targets [{stat, target}] when on.
    #[serde(default)]
    stats_auto: Option<serde_json::Value>,
    /// Learned skills {skill id: level}, e.g. {"AL_HEAL": 9}.
    #[serde(default)]
    skills: Option<serde_json::Value>,
    /// Unspent skill points.
    #[serde(default)]
    skill_points: u32,
    /// The game's auto-skill rules [{skill, lv, use, percent, ...}].
    #[serde(default)]
    skill_setup: Option<serde_json::Value>,
    /// Map name as the game shows it (地圖), e.g. 普隆德拉原野 09.
    map: Option<String>,
    /// Current action as the game shows it (行動), e.g. 戰鬥中.
    action: Option<String>,
    target: Option<Target>,
    /// Unix seconds when the tray received it.
    #[serde(default)]
    updated: u64,
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Target {
    name: String,
    lv: Option<f64>,
    hp: Option<f64>,
    max_hp: Option<f64>,
}

fn notify(app: &AppHandle) {
    let _ = app.emit_to("panel", "state-changed", ());
    // Menu bar text beside the icon: online / total, e.g. "2/5".
    if let (Some(tray), Some(p)) = (app.tray_by_id("main"), app.try_state::<Profiles>()) {
        let total = p.ids.lock().unwrap().len();
        let off = p.offline.lock().unwrap().len();
        let _ = tray.set_title(Some(format!("{}/{total}", total.saturating_sub(off))));
    }
}

// Copied from the game bundle's job table (snapshot.character.job -> display name).
// ponytail: static copy; new jobs show their raw id until added here.
const JOB_NAMES: &[(&str, &str)] = &[
    ("acolyte", "服事"),
    ("alchemist", "鍊金術師"),
    ("archer", "弓箭手"),
    ("assassin", "刺客"),
    ("assassin_cross", "十字刺客"),
    ("bard", "吟遊詩人"),
    ("blacksmith", "鐵匠"),
    ("champion", "武術宗師"),
    ("clown", "搞笑藝人"),
    ("creator", "創造者"),
    ("crusader", "十字軍"),
    ("dancer", "舞孃"),
    ("gypsy", "冷豔舞姬"),
    ("high_priest", "神官"),
    ("high_wizard", "超魔導師"),
    ("hunter", "獵人"),
    ("knight", "騎士"),
    ("lord_knight", "騎士領主"),
    ("mage", "魔法師"),
    ("merchant", "商人"),
    ("monk", "武道家"),
    ("novice", "初學者"),
    ("paladin", "聖殿十字軍"),
    ("priest", "祭司"),
    ("professor", "智者"),
    ("rogue", "流氓"),
    ("sage", "賢者"),
    ("sniper", "神射手"),
    ("stalker", "神行太保"),
    ("supernovice", "超級初心者"),
    ("swordman", "劍士"),
    ("thief", "盜賊"),
    ("whitesmith", "神工匠"),
    ("wizard", "巫師"),
];

/// Mirrors the game's own label: `*_high` reuses the base name plus （轉生）.
pub(crate) fn job_name(id: &str) -> String {
    let lookup = |k: &str| JOB_NAMES.iter().find(|(j, _)| *j == k).map(|(_, n)| *n);
    match id.strip_suffix("_high").and_then(lookup) {
        Some(n) => format!("{n}（轉生）"),
        None => lookup(id).map_or_else(|| id.chars().take(20).collect(), str::to_string),
    }
}

#[test]
fn job_names() {
    assert_eq!(job_name("lord_knight"), "騎士領主");
    assert_eq!(job_name("novice_high"), "初學者（轉生）");
    assert_eq!(job_name("new_job"), "new_job");
}

/// Keeps the saved order (it is the panel's display order), dropping duplicates.
fn parse_ids(s: &str) -> Vec<u8> {
    let mut ids: Vec<u8> = Vec::new();
    for n in s.split(',').filter_map(|x| x.trim().parse::<u8>().ok()) {
        if n >= 1 && !ids.contains(&n) {
            ids.push(n);
        }
    }
    ids
}

/// `profiles` holds e.g. "1,2,4". Falls back to the old `profile-count` file, then [1, 2].
fn load_profile_ids(app: &AppHandle) -> Vec<u8> {
    let dir = app.path().app_config_dir().ok();
    let read = |name: &str| {
        dir.as_ref()
            .and_then(|d| std::fs::read_to_string(d.join(name)).ok())
    };
    let ids = match read("profiles") {
        Some(s) => parse_ids(&s),
        None => read("profile-count")
            .and_then(|s| s.trim().parse::<u8>().ok())
            .map(|n| (1..=n).collect())
            .unwrap_or_default(),
    };
    if ids.is_empty() { vec![1, 2] } else { ids }
}

fn nicknames_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("nicknames.json"))
}

fn goals_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("goals.json"))
}

fn load_map(path: Option<std::path::PathBuf>) -> HashMap<String, String> {
    path.and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_map(path: Option<std::path::PathBuf>, map: &HashMap<String, String>) {
    let Some(p) = path else { return };
    let saved = p.parent().map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|_| std::fs::write(&p, serde_json::to_string_pretty(map).unwrap_or_default()));
    if let Err(e) = saved {
        eprintln!("[ro-idle-tray] cannot save {}: {e}", p.display());
    }
}

/// Board columns `[{name, members: [profile n]}]`, checked before saving.
fn valid_groups(v: &serde_json::Value) -> bool {
    v.as_array().is_some_and(|cols| {
        (1..=20).contains(&cols.len())
            && cols.iter().all(|c| {
                c["name"].as_str().is_some_and(|n| n.chars().count() <= 30)
                    && c["members"].as_array().is_some_and(|m| m.iter().all(|x| x.as_u64().is_some_and(|n| (1..=255).contains(&n))))
            })
    })
}

#[test]
fn groups_shape() {
    assert!(valid_groups(&serde_json::json!([{"name":"A","members":[1,5]},{"name":"B","members":[]}])));
    assert!(!valid_groups(&serde_json::json!([])));
    assert!(!valid_groups(&serde_json::json!([{"name":"A","members":[0]}])));
    assert!(!valid_groups(&serde_json::json!([{"members":[1]}])));
}

/// Board groups live in groups.json, not panel localStorage: `tauri dev` serves the
/// panel from a new 127.0.0.1 port each run, and localStorage is per origin.
#[tauri::command]
fn get_groups(app: AppHandle) -> serde_json::Value {
    app.path().app_config_dir().ok()
        .and_then(|d| std::fs::read_to_string(d.join("groups.json")).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(valid_groups)
        .unwrap_or(serde_json::Value::Null)
}

#[tauri::command]
fn set_groups(app: AppHandle, groups: serde_json::Value) -> Result<(), String> {
    if !valid_groups(&groups) {
        return Err("Invalid board groups".into());
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir)
        .and_then(|_| std::fs::write(dir.join("groups.json"), groups.to_string()))
        .map_err(|e| format!("Cannot save board groups: {e}"))
}

/// Empty goal clears it. Stored only in this app (goals.json), never sent to the game.
#[tauri::command]
fn set_goal(app: AppHandle, name: String, goal: String) {
    let goal: String = goal.trim().chars().filter(|c| !c.is_control()).take(20).collect();
    let state = app.state::<Profiles>();
    let mut map = state.goals.lock().unwrap();
    if goal.is_empty() { map.remove(&name); } else { map.insert(name, goal); }
    save_map(goals_path(&app), &map);
    drop(map);
    notify(&app);
}

fn load_nicknames(app: &AppHandle) -> HashMap<String, String> {
    nicknames_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Empty nickname clears it. Stored only in this app, never sent to the game.
#[tauri::command]
fn set_nickname(app: AppHandle, name: String, nickname: String) {
    let nick: String = nickname.trim().chars().filter(|c| !c.is_control()).take(30).collect();
    let state = app.state::<Profiles>();
    let mut map = state.nicknames.lock().unwrap();
    if nick.is_empty() {
        map.remove(&name);
    } else {
        map.insert(name, nick);
    }
    if let Some(p) = nicknames_path(&app) {
        let saved = p.parent().map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|_| std::fs::write(&p, serde_json::to_string_pretty(&*map).unwrap_or_default()));
        if let Err(e) = saved {
            eprintln!("[ro-idle-tray] cannot save nicknames: {e}");
        }
    }
    drop(map);
    for n in load_profile_ids(&app) {
        update_title(&app, n);
    }
    notify(&app);
}

/// Window title shows the character and its tag: "RO放置仙境 — 牙曝「Wizard」".
fn update_title(app: &AppHandle, n: u8) {
    let Some(w) = app.get_webview_window(&format!("game-profile-{n}")) else { return };
    let profiles = app.state::<Profiles>();
    let who = profiles.info.lock().unwrap().get(&n).map(|i| {
        match profiles.nicknames.lock().unwrap().get(&i.name) {
            Some(nick) => format!("{}「{nick}」", i.name),
            None => format!("{}（{}）", i.name, i.class),
        }
    });
    let _ = w.set_title(&format!("RO放置仙境 — {}", who.unwrap_or_else(|| format!("Account {n}"))));
}

fn save_profile_ids(app: &AppHandle, ids: &[u8]) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let list: Vec<String> = ids.iter().map(u8::to_string).collect();
    let result = std::fs::create_dir_all(&dir)
        .and_then(|_| std::fs::write(dir.join("profiles"), list.join(",")));
    if let Err(e) = result {
        eprintln!("[ro-idle-tray] cannot save profiles: {e}");
    }
}

#[test]
fn profile_ids_parse() {
    assert_eq!(parse_ids("4, 1,2,2,x,0"), vec![4, 1, 2]);
    assert!(parse_ids("").is_empty());
}

/// Returns the profile number when `id` is `profile-N` and N exists.
fn profile_number(app: &AppHandle, id: &str) -> Option<u8> {
    let n: u8 = id.strip_prefix("profile-")?.parse().ok()?;
    let profiles = app.state::<Profiles>();
    let found = profiles.ids.lock().unwrap().contains(&n);
    found.then_some(n)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(chat::ChatLock::default())
        .manage(atlas::MoveLock::default())
        .manage(PendingUpdate(Mutex::new(None)))
        .manage(PanelWidth(Mutex::new(360.0)))
        .manage(PanelLayout(Mutex::new(PanelGeom::default())))
        .invoke_handler(tauri::generate_handler![
            get_state,
            character_report,
            open_account,
            toggle_idle,
            atlas::recall_all,
            atlas::apply_stats,
            atlas::items_merge,
            atlas::items_apply,
            atlas::items_read,
            atlas::items_save,
            open_items,
            items_characters,
            enter_character,
            add_account,
            remove_account,
            set_login,
            update_app,
            open_export_folder,
            open_atlas,
            open_classes,
            atlas::atlas_characters,
            atlas::move_all,
            atlas::move_selected,
            set_nickname,
            set_goal,
            get_groups,
            set_groups,
            reorder_profiles,
            set_panel_width,
            set_pinned,
            open_guide,
            hide_panel,
            profile_menu,
            toggle_online,
            refresh_all,
            ai::ai_get_settings,
            ai::ai_save_settings,
            ai::ai_list_models,
            ai::ai_test_connection,
            chat::chat_history,
            chat::chat_send,
            chat::chat_new,
            chat::chat_character,
            chat::chat_memory,
            chat::chat_alerts,
            chat::chat_alert_open,
            chat::chat_alert_ack,
            chat::chat_tutorial,
            chat::open_assistant,
            chat::chat_plan,
            chat::chat_plan_set,
            quit
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let handle = app.handle().clone();
            app.on_menu_event(|app, e| {
                let id = e.id().as_ref();
                match id {
                    "tray-show" => return toggle_panel(app),
                    "tray-quit" => return app.exit(0),
                    _ => {}
                }
                if let Some(n) = id.strip_prefix("assist-").and_then(|r| r.parse::<u8>().ok()) {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let on = !app.state::<Profiles>().info.lock().unwrap().get(&n).is_some_and(|c| c.assist);
                        let body = match atlas::assist_mode(&app, n, on).await {
                            Ok(_) if !on => "已關閉（已設定的怪物保持不變）".to_string(),
                            Ok(0) => "已開啟：目前地圖沒有怪物，換圖後自動套用".to_string(),
                            Ok(k) => format!("已開啟：本圖 {k} 種怪物被打才還手，換圖自動套用"),
                            Err(e) => format!("設定失敗：{e}"),
                        };
                        println!("[ro-idle-tray] profile-{n} assist: {body}");
                        toast(&app, n, "輔助模式", &body);
                    });
                    return;
                }
                let (off, rest) = match id.split_once('-') {
                    Some(("online", r)) => (false, r),
                    Some(("offline", r)) => (true, r),
                    _ => return,
                };
                if let Ok(n) = rest.parse() {
                    set_offline(app, n, off);
                }
            });

            let ids = load_profile_ids(&handle);
            app.manage(Profiles {
                ids: Mutex::new(ids.clone()),
                info: Mutex::new(HashMap::new()),
                roster: Mutex::new(HashMap::new()),
                nicknames: Mutex::new(load_nicknames(&handle)),
                goals: Mutex::new(load_map(goals_path(&handle))),
                // Every boot starts all profiles online once so each one settles its offline
                // progress and shows it is healthy and idling; auto offline closes them after 3 min.
                offline: Mutex::new(Vec::new()),
                active_at: Mutex::new(HashMap::new()),
                woke_at: Mutex::new(std::time::Instant::now()),
            });
            *handle.state::<PanelLayout>().0.lock().unwrap() = load_panel_geometry(&handle);

            let roster_handle = handle.clone();
            app.listen("ro-idle-roster", move |event| {
                let Ok(r) = serde_json::from_str::<Roster>(event.payload()) else {
                    return;
                };
                let Some(n) = profile_number(&roster_handle, &r.profile) else {
                    return;
                };
                let clip = |t: &str, k| t.chars().filter(|c| !c.is_control()).take(k).collect::<String>();
                let chars = r
                    .chars
                    .into_iter()
                    .take(10)
                    .map(|c| RosterChar {
                        name: clip(&c.name, 40),
                        status: c.status.map(|s| clip(&s, 20)),
                        detail: clip(&c.detail, 80),
                    })
                    .collect::<Vec<_>>();
                eprintln!("[ro-idle-tray] {} roster: {}", r.profile, chars.iter().map(|c| format!("{} {}", c.name, c.detail)).collect::<Vec<_>>().join(" | "));
                roster_handle.state::<Profiles>().roster.lock().unwrap().insert(n, chars);
                notify(&roster_handle);
            });

            // Local read-only character API on 127.0.0.1 (token in api.json).
            let hook_handle = handle.clone();
            let _ = api::ONLINE_HOOK.set(Box::new(move |profile, off| {
                let ids = hook_handle.state::<Profiles>().ids.lock().unwrap().clone();
                if profile.is_some_and(|n| !ids.contains(&n)) {
                    return false;
                }
                let h = hook_handle.clone();
                let _ = hook_handle.run_on_main_thread(move || match profile {
                    Some(n) => set_offline(&h, n, off),
                    None => set_all_offline(h, off),
                });
                true
            }));
            if let Ok(dir) = handle.path().app_config_dir() {
                api::start(dir);
            }

            let log_handle = handle.clone();
            app.listen("ro-idle-log", move |event| {
                #[derive(serde::Deserialize)]
                struct LogMsg { profile: String, data: String }
                let Ok(m) = serde_json::from_str::<LogMsg>(event.payload()) else { return };
                let Some(n) = profile_number(&log_handle, &m.profile) else { return };
                let Ok(dir) = log_handle.path().app_config_dir().map(|d| d.join("logs")) else { return };
                let name = log_handle.state::<Profiles>().info.lock().unwrap().get(&n).map(|i| i.name.clone()).unwrap_or_default();
                // One file per character (profile id until its first snapshot arrives).
                let stem: String = if name.is_empty() { m.profile.clone() } else {
                    name.chars().map(|c| if c.is_control() || "/\\:".contains(c) { '_' } else { c }).collect()
                };
                let ts = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
                // Auto-rotate daily (UTC): <char>-YYYY-MM-DD.log. When a new day's file starts,
                // delete logs not written in the last 3 days.
                let path = dir.join(format!("{stem}-{}.log", utc_date(ts)));
                if !path.exists() {
                    for f in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                        let old = f.metadata().and_then(|m| m.modified()).ok()
                            .and_then(|t| t.elapsed().ok()).is_some_and(|age| age > Duration::from_secs(3 * 86400));
                        if old && f.path().extension().is_some_and(|e| e == "log") {
                            let _ = std::fs::remove_file(f.path());
                        }
                    }
                }
                let line = format!("{ts}\t{name}\t{}\n", m.data.replace('\n', " "));
                let _ = std::fs::create_dir_all(&dir).and_then(|_| {
                    use std::io::Write;
                    std::fs::OpenOptions::new().create(true).append(true).open(&path)?.write_all(line.as_bytes())
                });
            });

            let cap_handle = handle.clone();
            app.listen("ro-idle-capture", move |event| {
                #[derive(serde::Deserialize)]
                struct Cap { profile: String, rec: String }
                let Ok(m) = serde_json::from_str::<Cap>(event.payload()) else { return };
                if profile_number(&cap_handle, &m.profile).is_none() { return }
                let Ok(dir) = cap_handle.path().app_config_dir().map(|d| d.join("capture")) else { return };
                let ts = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
                // ponytail: no rotation/cleanup; dev-only, delete the folder when done.
                let path = dir.join(format!("{}-{}.jsonl", m.profile, utc_date(ts)));
                let _ = std::fs::create_dir_all(&dir).and_then(|_| {
                    use std::io::Write;
                    std::fs::OpenOptions::new().create(true).append(true).open(&path)?
                        .write_all(format!("{}\n", m.rec.replace('\n', " ")).as_bytes())
                });
            });

            // Right click: a small menu (show the panel, quit); left click toggles the panel.
            let tray_menu = tauri::menu::Menu::with_items(app, &[
                &tauri::menu::MenuItem::with_id(app, "tray-show", "顯示 / 隱藏面板", true, None::<&str>)?,
                &tauri::menu::PredefinedMenuItem::separator(app)?,
                &tauri::menu::MenuItem::with_id(app, "tray-quit", "結束 RO Idle Tray", true, Some("CmdOrCtrl+Q"))?,
            ])?;
            TrayIconBuilder::with_id("main")
                // Sleepy Jelly, black + alpha; macOS tints template icons for light/dark bars.
                .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(true)
                .tooltip("RO 放置仙境")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_panel(tray.app_handle());
                    }
                })
                .build(app)?;
            notify(&handle);
            // Read once: a guard held across the builder chain would deadlock the next lock.
            let pinned = handle.state::<PanelLayout>().0.lock().unwrap().pinned;
            let panel =
                WebviewWindowBuilder::new(app, "panel", WebviewUrl::App("index.html".into()))
                    .title("RO Idle Tray")
                    .inner_size(360.0, 900.0)
                    .resizable(true)
                    .decorations(false)
                    .transparent(true)
                    .always_on_top(pinned)
                    .visible_on_all_workspaces(pinned)
                    .skip_taskbar(true)
                    .visible(false)
                    // Tauri's file-drop handler swallows HTML5 drag events; the panel reorders by drag.
                    .disable_drag_drop_handler()
                    .build()?;
            let layout_handle = handle.clone();
            panel.on_window_event(move |event| match event {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => save_panel_geometry(&layout_handle),
                _ => {}
            });
            // Boot every profile hidden so it logs in, enters its first
            // character and fills the tray label without a click.
            let offline = handle.state::<Profiles>().offline.lock().unwrap().clone();
            for n in ids.into_iter().filter(|n| !offline.contains(n)) {
                open_profile(&handle, &format!("profile-{n}"), false);
            }
            let poll_handle = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(30));
                poll_profiles(&poll_handle);
            });
            let update_handle = handle.clone();
            std::thread::spawn(move || {
                loop {
                    tauri::async_runtime::block_on(check_update(&update_handle));
                    std::thread::sleep(std::time::Duration::from_secs(6 * 60 * 60));
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running application");
}

const LAUNCH_AGENT_LABEL: &str = "com.mikewong.ro-idle-tray";

fn launch_agent_path() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        std::path::Path::new(&home)
            .join(format!("Library/LaunchAgents/{LAUNCH_AGENT_LABEL}.plist")),
    )
}

/// Login item via a per-user LaunchAgent pointing at the current executable.
// ponytail: records the exe path at enable time; re-toggle after moving the .app.
fn set_autostart(on: bool) -> std::io::Result<()> {
    let path = launch_agent_path().ok_or(std::io::ErrorKind::NotFound)?;
    if !on {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    let exe = std::env::current_exe()?
        .to_string_lossy()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(
        &path,
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key><array><string>{exe}</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
"#
        ),
    )
}

fn toggle_autostart(app: &AppHandle) {
    let want = launch_agent_path().is_none_or(|p| !p.exists());
    let result = set_autostart(want);
    if let Err(e) = &result {
        eprintln!("[ro-idle-tray] autostart: {e}");
    }
    notify(app);
}

fn add_profile(app: &AppHandle) {
    let profiles = app.state::<Profiles>();
    let mut ids = profiles.ids.lock().unwrap();
    let Some(next) = ids.iter().max().copied().unwrap_or(0).checked_add(1) else {
        return;
    };
    ids.push(next);
    save_profile_ids(app, &ids);
    drop(ids);
    notify(app);
    open_profile(app, &format!("profile-{next}"), true);
}

/// Native macOS dialog via osascript (no dialog plugin). True when `ok` was clicked.
fn dialog(message: &str, ok: &str, cancel: Option<&str>) -> bool {
    let q = |s: &str| format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""));
    let buttons = match cancel {
        Some(c) => format!("{{{}, {}}} cancel button {}", q(c), q(ok), q(c)),
        None => format!("{{{}}}", q(ok)),
    };
    let script = format!(
        "display dialog {} with title \"RO Idle Tray\" buttons {buttons} default button {} with icon caution",
        q(message),
        q(ok)
    );
    std::process::Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .is_ok_and(|o| o.status.success())
}

/// macOS banner under the app's own name and icon. Clicking it opens that profile's game window.
fn toast(app: &AppHandle, n: u8, title: &str, body: &str) {
    #[cfg(target_os = "macos")]
    {
        let (app, title, body) = (app.clone(), title.to_string(), body.to_string());
        // send() with wait_for_click blocks until the banner is clicked or dismissed.
        std::thread::spawn(move || {
            let _ = mac_notification_sys::set_application(&app.config().identifier);
            let clicked = mac_notification_sys::Notification::new()
                .title(&title)
                .message(&body)
                .sound("Glass")
                .wait_for_click(true)
                .send();
            if matches!(clicked, Ok(mac_notification_sys::NotificationResponse::Click)) {
                let h = app.clone();
                let _ = app.run_on_main_thread(move || open_profile(&h, &format!("profile-{n}"), true));
            }
        });
    }
}

fn confirm_remove(app: &AppHandle, id: &str) {
    let Some(n) = id
        .strip_prefix("remove-")
        .and_then(|p| profile_number(app, p))
    else {
        return;
    };
    let profiles = app.state::<Profiles>();
    let last = profiles.ids.lock().unwrap().len() <= 1;
    let label = profiles.info.lock().unwrap().get(&n).map_or_else(
        || "Not signed in".to_string(),
        |i| {
            format!(
                "{}（{}） Base Lv{} / Job Lv{}",
                i.name, i.class, i.base, i.job
            )
        },
    );
    let app = app.clone();
    // Dialog blocks, so keep it off the main thread.
    std::thread::spawn(move || {
        if last {
            dialog("You can't remove the last profile.", "OK", None);
            return;
        }
        let message = format!(
            "Remove Account {n}?\n\n{label}\n\nThis closes its window and deletes this profile's saved Google login and game data. This cannot be undone."
        );
        if !dialog(&message, "Remove", Some("Cancel")) {
            return;
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || remove_profile(&handle, n));
    });
}

fn remove_profile(app: &AppHandle, n: u8) {
    let id = format!("profile-{n}");
    if let Some(window) = app.get_webview_window(&format!("game-{id}")) {
        let _ = window.destroy();
    }
    let profiles = app.state::<Profiles>();
    {
        let mut ids = profiles.ids.lock().unwrap();
        ids.retain(|x| *x != n);
        save_profile_ids(app, &ids);
    }
    profiles.info.lock().unwrap().remove(&n);
    profiles.roster.lock().unwrap().remove(&n);
    // Profile id is gone already, so this only drops it from the saved offline list.
    set_offline(app, n, false);
    notify(app);
    let handle = app.clone();
    std::thread::spawn(move || {
        // ponytail: fixed wait for the WebView to let go of its store; retry if WebKit ever reports "in use".
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Err(e) =
            tauri::async_runtime::block_on(handle.remove_data_store(profile_store_id(n)))
        {
            eprintln!("[ro-idle-tray] cannot delete data store for {n}: {e}");
        }
    });
}

/// Stable per-profile WebKit data store. Profiles 1 and 2 keep their original IDs.
fn profile_store_id(n: u8) -> [u8; 16] {
    [
        0x52, 0x4f, 0x49, 0x44, 0x4c, 0x45, n, 0x00, 0x90, 0, 0, 0, 0, 0, 0, n,
    ]
}

fn open_profile(app: &AppHandle, profile: &str, show: bool) {
    let Some(n) = profile_number(app, profile) else {
        return;
    };
    let label = format!("game-{profile}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.move_window(tauri_plugin_positioner::Position::TrayCenter);
        return;
    }
    // Dev builds also record raw API traffic (src/capture.js) for the offline-backend work.
    let capture = if cfg!(debug_assertions) { include_str!("../../src/capture.js") } else { "" };
    let script = format!("const RO_IDLE_PROFILE = {profile:?};{}{CHARACTER_HOOK}{capture}{}", format!("{}{}", include_str!("../../src/move.js"), include_str!("../../src/items.js")), format!("{}{}", include_str!("../../src/tutorial-ui.js"), include_str!("../../src/bubble.js")));
    let builder = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::External("https://ro-idle.app/".parse().unwrap()),
    )
    .title(format!("RO放置仙境 — Account {n}"))
    .inner_size(1100.0, 760.0)
    .min_inner_size(800.0, 580.0)
    .data_store_identifier(profile_store_id(n))
    .visible(show)
    .initialization_script(script)
    .on_download(|_, event| {
        match event {
            tauri::webview::DownloadEvent::Requested { destination, .. } => {
                if let Some(path) = export_path(destination) {
                    *destination = path;
                }
            }
            tauri::webview::DownloadEvent::Finished { success: true, .. } => open_exports(),
            _ => {}
        }
        true
    });
    match builder.build() {
        Ok(window) => {
            #[cfg(target_os = "macos")]
            let _ = window.with_webview(|w| js_dialogs::install(w.inner()));
            let close_window = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = close_window.hide();
                }
            });
        }
        Err(error) => eprintln!("Cannot open Account {n}: {error}"),
    }
}

struct PendingUpdate(Mutex<Option<Update>>);

/// Checks GitHub for a newer release; the panel then shows "Update to vX".
// ponytail: never installs on its own; the idle game keeps running until the user clicks.
async fn check_update(app: &AppHandle) {
    let checked = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(e) => return eprintln!("[ro-idle-tray] updater: {e}"),
    };
    let update = match checked {
        Ok(Some(u)) => u,
        Ok(None) => return,
        Err(e) => return eprintln!("[ro-idle-tray] update check: {e}"),
    };
    *app.state::<PendingUpdate>().0.lock().unwrap() = Some(update);
    notify(app);
}

fn install_update(app: &AppHandle) {
    let Some(update) = app.state::<PendingUpdate>().0.lock().unwrap().take() else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match update.download_and_install(|_, _| {}, || {}).await {
            Ok(()) => app.restart(),
            Err(e) => {
                eprintln!("[ro-idle-tray] update install: {e}");
                *app.state::<PendingUpdate>().0.lock().unwrap() = Some(update);
            }
        }
    });
}

/// Hide the panel. The tray icon brings it back; the panel never hides on blur.
fn hide_panel_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("panel") {
        let _ = w.hide();
    }
}

/// Header button: hide the panel without quitting the app.
#[tauri::command]
fn hide_panel(app: AppHandle) {
    hide_panel_window(&app);
}

fn toggle_panel(app: &AppHandle) {
    let Some(w) = app.get_webview_window("panel") else {
        return;
    };
    if w.is_visible().unwrap_or(false) {
        hide_panel_window(app);
    } else {
        show_panel(app);
    }
}

pub(crate) fn show_panel(app: &AppHandle) {
    let Some(w) = app.get_webview_window("panel") else {
        return;
    };
    if !w.is_visible().unwrap_or(false) {
        if !restore_panel(&w) {
            place_panel(&w, *app.state::<PanelWidth>().0.lock().unwrap());
        }
        let _ = w.show();
        notify(app);
        poll_profiles(app);
    }
    let _ = w.set_focus();
}

/// Panel width in logical px: 360 for list/grid, wider for the board view.
struct PanelWidth(Mutex<f64>);

/// Tall as the screen allows (below the menu bar), under the tray icon, kept on screen.
fn place_panel(w: &tauri::WebviewWindow, width: f64) {
    let Ok(Some(m)) = w.current_monitor() else { return };
    let sf = m.scale_factor();
    let (left, screen_w) = (m.position().x as f64 / sf, m.size().width as f64 / sf);
    let h = (m.size().height as f64 / sf - 80.0).clamp(480.0, 1100.0);
    let width = width.min(screen_w - 16.0);
    let _ = w.set_size(tauri::LogicalSize::new(width, h));
    let _ = w.move_window(tauri_plugin_positioner::Position::TrayBottomCenter);
    // A wide board under a tray icon near the screen edge would hang off screen.
    // Only touch the position then: a read-back right after the resize can carry a stale y.
    if let Ok(p) = w.outer_position() {
        let x = p.x as f64 / sf;
        let fixed = x.clamp(left + 8.0, (left + screen_w - width - 8.0).max(left + 8.0));
        if (fixed - x).abs() > 1.0 {
            let _ = w.set_position(tauri::LogicalPosition::new(fixed, m.position().y as f64 / sf + 30.0));
        }
    }
}

#[tauri::command]
fn set_panel_width(app: AppHandle, width: f64) {
    let width = if width.is_finite() { width.clamp(360.0, 2400.0) } else { 360.0 };
    let state = app.state::<PanelWidth>();
    if std::mem::replace(&mut *state.0.lock().unwrap(), width) == width {
        return;
    }
    if app.state::<PanelLayout>().0.lock().unwrap().rect.is_some() {
        return; // user moved/resized it: their size wins
    }
    if let Some(w) = app.get_webview_window("panel").filter(|w| w.is_visible().unwrap_or(false)) {
        place_panel(&w, width);
    }
}

/// Panel position/size (physical px) the user left it at, and the pin. Saved to panel.json.
#[derive(serde::Serialize, serde::Deserialize, Default, Clone, Copy)]
struct PanelGeom {
    rect: Option<(i32, i32, u32, u32)>,
    #[serde(default)]
    pinned: bool,
}
struct PanelLayout(Mutex<PanelGeom>);

fn panel_geometry_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("panel.json"))
}

fn load_panel_geometry(app: &AppHandle) -> PanelGeom {
    panel_geometry_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_panel_geometry(app: &AppHandle, g: PanelGeom) {
    if let Some(p) = panel_geometry_path(app) {
        let _ = std::fs::write(p, serde_json::to_string(&g).unwrap_or_default());
    }
}

/// Moved/Resized while visible: remember it. ponytail: writes on every event of a drag (tiny file).
fn save_panel_geometry(app: &AppHandle) {
    let Some(w) = app.get_webview_window("panel").filter(|w| w.is_visible().unwrap_or(false)) else { return };
    let (Ok(p), Ok(s)) = (w.outer_position(), w.inner_size()) else { return };
    let state = app.state::<PanelLayout>();
    let g = {
        let mut g = state.0.lock().unwrap();
        g.rect = Some((p.x, p.y, s.width, s.height));
        *g
    };
    write_panel_geometry(app, g);
}

/// Put the panel back where the user left it; false if nothing saved or that screen is gone.
fn restore_panel(w: &tauri::WebviewWindow) -> bool {
    let Some((x, y, width, height)) = w.app_handle().state::<PanelLayout>().0.lock().unwrap().rect else { return false };
    let on_screen = w.available_monitors().unwrap_or_default().iter().any(|m| {
        let (mp, ms) = (m.position(), m.size());
        x + 40 > mp.x && x < mp.x + ms.width as i32 - 40 && y >= mp.y && y < mp.y + ms.height as i32 - 40
    });
    if on_screen {
        let _ = w.set_size(tauri::PhysicalSize::new(width, height));
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    }
    on_screen
}

/// Pinned: float above other apps and across Spaces, PiP-style.
#[tauri::command]
fn set_pinned(app: AppHandle, pinned: bool) {
    let state = app.state::<PanelLayout>();
    let g = {
        let mut g = state.0.lock().unwrap();
        g.pinned = pinned;
        *g
    };
    write_panel_geometry(&app, g);
    if let Some(w) = app.get_webview_window("panel") {
        let _ = w.set_always_on_top(pinned);
        let _ = w.set_visible_on_all_workspaces(pinned);
    }
    notify(&app);
}

/// Unix seconds -> "YYYY-MM-DD" (UTC), civil-from-days (Howard Hinnant).
fn utc_date(ts: u64) -> String {
    let z = (ts / 86400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
#[test]
fn utc_date_known_days() {
    assert_eq!(utc_date(0), "1970-01-01");
    assert_eq!(utc_date(951_782_400), "2000-02-29");
    assert_eq!(utc_date(1_793_637_359), "2026-11-02");
}

/// Ask every game window to re-fetch its snapshot (CHARACTER_HOOK's __roIdlePoll).
fn poll_profiles(app: &AppHandle) {
    auto_offline_tick(app);
    // Reopen any online profile that lost its window (e.g. offline→online faster than destroy completes).
    let profiles = app.state::<Profiles>();
    let ids = profiles.ids.lock().unwrap().clone();
    let offline = profiles.offline.lock().unwrap().clone();
    for n in ids.into_iter().filter(|n| !offline.contains(n)) {
        if app.get_webview_window(&format!("game-profile-{n}")).is_none() {
            open_profile(app, &format!("profile-{n}"), false);
        }
    }
    for (label, w) in app.webview_windows() {
        if label.starts_with("game-") {
            let hidden = !w.is_visible().unwrap_or(true);
            let _ = w.eval(format!("window.__roIdlePoll && window.__roIdlePoll({hidden})"));
        }
    }
}

#[derive(serde::Serialize)]
struct ProfileView {
    n: u8,
    info: Option<CharacterLabel>,
    roster: Vec<RosterChar>,
    offline: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelState {
    version: String,
    autostart: bool,
    update: Option<String>,
    profiles: Vec<ProfileView>,
    nicknames: HashMap<String, String>,
    goals: HashMap<String, String>,
    pinned: bool,
    /// Seconds until the hourly wake brings offline profiles back.
    wake_in: u64,
}

#[tauri::command]
fn get_state(app: AppHandle) -> PanelState {
    let profiles = app.state::<Profiles>();
    let ids = profiles.ids.lock().unwrap().clone();
    let info = profiles.info.lock().unwrap();
    let roster = profiles.roster.lock().unwrap();
    let offline = profiles.offline.lock().unwrap().clone();
    let update = app
        .state::<PendingUpdate>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|u| u.version.clone());
    PanelState {
        version: app.package_info().version.to_string(),
        autostart: launch_agent_path().is_some_and(|p| p.exists()),
        update,
        profiles: ids
            .into_iter()
            .map(|n| ProfileView {
                n,
                info: info.get(&n).cloned(),
                roster: roster.get(&n).cloned().unwrap_or_default(),
                offline: offline.contains(&n),
            })
            .collect(),
        nicknames: profiles.nicknames.lock().unwrap().clone(),
        goals: profiles.goals.lock().unwrap().clone(),
        pinned: app.state::<PanelLayout>().0.lock().unwrap().pinned,
        wake_in: WAKE_EVERY.saturating_sub(profiles.woke_at.lock().unwrap().elapsed()).as_secs(),
    }
}

/// Refresh button: boot offline profiles one at a time, in panel order, so each loads its
/// latest numbers; each goes offline again a minute later like any closed window.
/// Returns how many will boot (the panel keeps the button busy that long).
#[tauri::command]
fn refresh_all(app: AppHandle) -> usize {
    static BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let profiles = app.state::<Profiles>();
    let offline = profiles.offline.lock().unwrap().clone();
    let order: Vec<u8> = profiles.ids.lock().unwrap().iter().copied().filter(|n| offline.contains(n)).collect();
    if order.is_empty() || BUSY.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return 0;
    }
    let count = order.len();
    std::thread::spawn(move || {
        for n in order {
            let h = app.clone();
            let _ = app.run_on_main_thread(move || set_offline(&h, n, false));
            // ponytail: fixed gap so pages don't all log in at once; tune if the server minds.
            std::thread::sleep(REFRESH_GAP);
        }
        BUSY.store(false, std::sync::atomic::Ordering::SeqCst);
    });
    count
}
const REFRESH_GAP: Duration = Duration::from_secs(5);

/// Status dot on a card: flip that profile between online and offline.
#[tauri::command]
fn toggle_online(app: AppHandle, n: u8) {
    let profiles = app.state::<Profiles>();
    let off = profiles.offline.lock().unwrap().contains(&n);
    set_offline(&app, n, !off);
}

#[tauri::command]
fn open_account(app: AppHandle, n: u8) {
    // Opening the game is going online.
    set_offline(&app, n, false);
    open_profile(&app, &format!("profile-{n}"), true);
}

/// Presses the game's own start/stop button inside that profile's hidden window.
#[tauri::command]
fn toggle_idle(app: AppHandle, n: u8) {
    if let Some(w) = app.get_webview_window(&format!("game-profile-{n}")) {
        let _ = w.eval("window.__roIdleToggle && window.__roIdleToggle()");
    }
}

/// Presses 進入 on row `i` of that profile's character select screen.
#[tauri::command]
fn enter_character(app: AppHandle, n: u8, i: usize) {
    if let Some(w) = app.get_webview_window(&format!("game-profile-{n}")) {
        let _ = w.eval(format!("window.__roIdleEnter && window.__roIdleEnter({i})"));
    }
}

/// Drag-and-drop reorder from the panel. Ignored unless it's a permutation of the current ids.
#[tauri::command]
fn reorder_profiles(app: AppHandle, order: Vec<u8>) {
    let profiles = app.state::<Profiles>();
    let mut ids = profiles.ids.lock().unwrap();
    let (mut a, mut b) = (ids.clone(), order.clone());
    a.sort_unstable();
    b.sort_unstable();
    if a != b {
        return;
    }
    *ids = order;
    save_profile_ids(&app, &ids);
    drop(ids);
    notify(&app);
}

#[tauri::command]
fn add_account(app: AppHandle) {
    add_profile(&app);
}

#[tauri::command]
fn remove_account(app: AppHandle, n: u8) {
    confirm_remove(&app, &format!("remove-profile-{n}"));
}

#[tauri::command]
fn set_login(app: AppHandle) {
    toggle_autostart(&app);
}

#[tauri::command]
fn update_app(app: AppHandle) {
    install_update(&app);
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// Game exports (settings, local saves) land here instead of loose in ~/Downloads.
pub(crate) fn export_dir() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(std::path::Path::new(&home).join("Downloads/RO Idle Tray"))
}

/// Same file name inside export_dir, with " (n)" added when it already exists.
fn export_path(suggested: &std::path::Path) -> Option<std::path::PathBuf> {
    let dir = export_dir()?;
    std::fs::create_dir_all(&dir).ok()?;
    let name = suggested.file_name()?.to_string_lossy().to_string();
    let (stem, ext) = name
        .split_once('.')
        .map_or((name.as_str(), String::new()), |(s, e)| {
            (s, format!(".{e}"))
        });
    let mut path = dir.join(&name);
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    Some(path)
}

fn open_exports() {
    if let Some(dir) = export_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::process::Command::new("/usr/bin/open").arg(dir).spawn();
    }
}

/// Offline map/monster atlas (src/atlas.html), optionally searching for `q`.
#[tauri::command]
fn open_atlas(app: AppHandle, q: Option<String>) {
    let q = q.unwrap_or_default();
    let q_js = serde_json::to_string(&q).unwrap_or_else(|_| "\"\"".into());
    if let Some(w) = app.get_webview_window("atlas") {
        let _ = w.eval(format!("window.atlasSearch && window.atlasSearch({q_js})"));
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(&app, "atlas", WebviewUrl::App("atlas.html".into()))
        .title("RO Map Atlas")
        .inner_size(1100.0, 800.0)
        .initialization_script(format!("window.ATLAS_Q = {q_js};"))
        .build();
}

/// Player-made strategy guide (class builds, skill simulator, gear keep/sell lists).
/// Label "guide" matches no capability, so the external page gets no IPC.
#[tauri::command]
fn open_guide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("guide") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(
        &app,
        "guide",
        WebviewUrl::External("https://ned-lin-9527.github.io/Ragnarok/index.html".parse().unwrap()),
    )
    .title("RO 放置仙境攻略")
    .inner_size(1100.0, 820.0)
    .build();
}

/// Class progression chart (src/classes.html), bundled with the tray.
#[tauri::command]
fn open_classes(app: AppHandle) {
    if let Some(w) = app.get_webview_window("classes") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(&app, "classes", WebviewUrl::App("classes.html".into()))
        .title("RO Class Chart")
        .inner_size(1000.0, 820.0)
        .build();
}

/// Item editor's character labels: live class plus the panel's nickname and goal.
#[tauri::command]
fn items_characters(app: AppHandle) -> Vec<serde_json::Value> {
    let (nicks, goals) = (load_map(nicknames_path(&app)), load_map(goals_path(&app)));
    let profiles = app.state::<Profiles>();
    let info = profiles.info.lock().unwrap();
    let mut list: Vec<_> = info.iter().collect();
    list.sort_by_key(|(n, _)| **n);
    list.into_iter()
        .map(|(_, c)| serde_json::json!({"name": c.name, "class": c.class, "nickname": nicks.get(&c.name), "goal": goals.get(&c.name)}))
        .collect()
}

/// Item settings editor (src/items.html): one table for every character's 道具設定.
#[tauri::command]
fn open_items(app: AppHandle) {
    // Editing fans out through the game pages, so they all come online while the editor is open.
    set_all_offline(app.clone(), false);
    if let Some(w) = app.get_webview_window("items") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(&app, "items", WebviewUrl::App("items.html".into()))
        .title("RO Item Settings")
        .inner_size(1100.0, 820.0)
        .build();
}

#[tauri::command]
fn open_export_folder() {
    open_exports();
}

// The hosted game supplies snapshot contents; its profile identity comes from the caller.
#[tauri::command]
fn character_report(window: tauri::WebviewWindow, app: AppHandle, mut data: CharacterLabel) {
    let Ok(n) = chat::game_profile(&window, &app) else {
        return;
    };
    data.profile = format!("profile-{n}");
    let listen_handle = app;
    if profile_number(&listen_handle, &data.profile).is_none() {
        return;
    }
    let name: String = data
        .name
        .chars()
        .filter(|c| !c.is_control())
        .take(40)
        .collect();
    let class = job_name(data.class.trim());
    eprintln!(
        "[ro-idle-tray] {} => {name}（{class}） Base Lv{} / Job Lv{} @ {}{}",
        data.profile,
        data.base,
        data.job,
        data.map.as_deref().unwrap_or("?"),
        data.assist_note.as_deref().map(|n| format!(" · assist {n}")).unwrap_or_default()
    );
    let profiles = listen_handle.state::<Profiles>();
    if let Some(n) = profile_number(&listen_handle, &data.profile) {
        let mut info = data.clone();
        info.name = name.clone();
        info.class = class.clone();
        info.updated = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        let prev = {
            let mut all = profiles.info.lock().unwrap();
            let prev = all.insert(n, info);
            // ponytail: rewrites whole file per update (~3s, few KB); fine for a handful of profiles.
            if let Ok(dir) = listen_handle.path().app_config_dir() {
                let _ = std::fs::write(
                    dir.join("characters.json"),
                    serde_json::to_string_pretty(&*all).unwrap_or_default(),
                );
            }
            prev
        };
        // Only on a real increase for the same character, never on first sight.
        let who = match profiles.nicknames.lock().unwrap().get(&name) {
            Some(nick) => format!("{name}「{nick}」"),
            None => format!("{name}（{class}）"),
        };
        if let Some(p) = prev.filter(|p| p.name == name) {
            let mut ups = Vec::new();
            if data.base > p.base {
                ups.push(format!("Base Lv{}", data.base));
            }
            if data.job > p.job {
                ups.push(format!("Job Lv{}", data.job));
            }
            if !ups.is_empty() {
                toast(&listen_handle, n, &format!("{who}升級！"), &ups.join(" · "));
            }
            if p.running == Some(true) && data.running == Some(false) {
                let at = data
                    .map
                    .as_deref()
                    .map_or(String::new(), |m| format!(" @ {m}"));
                toast(
                    &listen_handle,
                    n,
                    &format!("{who}已停止掛機"),
                    &format!("Base Lv{} / Job Lv{}{at}", data.base, data.job),
                );
            }
        }
        update_title(&listen_handle, n);
        notify(&listen_handle);
    }
}


/// Offline destroys the profile's game window (no page, no stream, no live server ticks);
/// online boots it hidden again. Last known character data stays for comparison.
fn set_offline(app: &AppHandle, n: u8, off: bool) {
    let profiles = app.state::<Profiles>();
    {
        let mut list = profiles.offline.lock().unwrap();
        if list.contains(&n) == off {
            return;
        }
        if off { list.push(n) } else { list.retain(|x| *x != n) }
    }
    // Coming online starts a full countdown.
    profiles.active_at.lock().unwrap().remove(&n);
    let label = format!("game-profile-{n}");
    if off {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.destroy();
        }
        profiles.roster.lock().unwrap().remove(&n);
    } else if app.get_webview_window(&label).is_none() {
        open_profile(app, &format!("profile-{n}"), false);
    }
    notify(app);
}

const AUTO_OFFLINE_AFTER: Duration = Duration::from_secs(60);
/// Every offline profile comes online at least this often, so its offline progress is
/// settled and the panel shows fresh numbers; auto offline closes it again a minute later.
const WAKE_EVERY: Duration = Duration::from_secs(3600);

/// RO_IDLE_CAFFEINATE_SECS=7200 keeps every profile online (streaming) for that long after launch,
/// e.g. to record API traffic. ponytail: ad hoc env switch; add a UI toggle if it sticks.
fn caffeinated() -> bool {
    static UNTIL: std::sync::OnceLock<Option<std::time::Instant>> = std::sync::OnceLock::new();
    UNTIL
        .get_or_init(|| {
            let secs: u64 = std::env::var("RO_IDLE_CAFFEINATE_SECS").ok()?.parse().ok()?;
            Some(std::time::Instant::now() + Duration::from_secs(secs))
        })
        .is_some_and(|t| std::time::Instant::now() < t)
}

/// Offline is the default: a profile whose game window stays closed for a minute goes offline.
/// Offline earns ~97% of online EXP (e2e 2026-11-03) at no local or server cost.
fn auto_offline_tick(app: &AppHandle) {
    let profiles = app.state::<Profiles>();
    if caffeinated() {
        let waking = profiles.offline.lock().unwrap().clone();
        if !waking.is_empty() {
            let h = app.clone();
            let _ = app.run_on_main_thread(move || waking.into_iter().for_each(|n| set_offline(&h, n, false)));
        }
        return;
    }
    let due = {
        let mut woke = profiles.woke_at.lock().unwrap();
        let due = woke.elapsed() >= WAKE_EVERY;
        if due {
            *woke = std::time::Instant::now();
        }
        due
    };
    if due {
        let waking = profiles.offline.lock().unwrap().clone();
        if !waking.is_empty() {
            let h = app.clone();
            let _ = app.run_on_main_thread(move || waking.into_iter().for_each(|n| set_offline(&h, n, false)));
            return;
        }
    }
    // Each profile counts down on its own: its game window visible (or the item editor,
    // which needs every page) holds it at a full minute.
    let visible = |label: &str| app.get_webview_window(label).is_some_and(|w| w.is_visible().unwrap_or(false));
    let hold_all = visible("items");
    let offline = profiles.offline.lock().unwrap().clone();
    let now = std::time::Instant::now();
    let going: Vec<u8> = {
        let mut at = profiles.active_at.lock().unwrap();
        profiles.ids.lock().unwrap().iter().copied().filter(|n| !offline.contains(n)).filter(|&n| {
            let t = at.entry(n).or_insert(now);
            if hold_all || visible(&format!("game-profile-{n}")) {
                *t = now;
            }
            t.elapsed() >= AUTO_OFFLINE_AFTER
        }).collect()
    };
    if going.is_empty() {
        return;
    }
    let h = app.clone();
    let _ = app.run_on_main_thread(move || going.into_iter().for_each(|n| set_offline(&h, n, true)));
}

/// Right-click menu on a profile card: Online (game kept in a hidden window) vs Offline (closed).
#[tauri::command]
fn profile_menu(window: tauri::Window, app: AppHandle, n: u8) -> Result<(), String> {
    use tauri::menu::{CheckMenuItem, Menu};
    let off = app.state::<Profiles>().offline.lock().unwrap().contains(&n);
    let on_item = CheckMenuItem::with_id(&app, format!("online-{n}"), "Online（背景保持遊戲網頁）", true, !off, None::<&str>)
        .map_err(|e| e.to_string())?;
    let off_item = CheckMenuItem::with_id(&app, format!("offline-{n}"), "Offline（完全關閉背景網頁）", true, off, None::<&str>)
        .map_err(|e| e.to_string())?;
    let on = app.state::<Profiles>().info.lock().unwrap().get(&n).is_some_and(|c| c.assist);
    let assist = CheckMenuItem::with_id(&app, format!("assist-{n}"), "輔助模式（本圖怪物被打才還手，換圖自動套用）", !off, on, None::<&str>)
        .map_err(|e| e.to_string())?;
    let sep = tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&on_item, &off_item, &sep, &assist]).map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

/// API /online and /offline without a profile: every profile at once.
fn set_all_offline(app: AppHandle, off: bool) {
    let ids = app.state::<Profiles>().ids.lock().unwrap().clone();
    for n in ids {
        set_offline(&app, n, off);
    }
}
