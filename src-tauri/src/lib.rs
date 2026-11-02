use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder,
    image::Image,
    tray::{MouseButtonState, TrayIconBuilder, TrayIconEvent},
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
  // The game closes its live stream 5s after the page goes hidden and reopens it
  // when visible. While the tray panel is open, Rust calls __roIdleLive(true) so
  // hidden windows report "visible" and the game keeps its own stream running.
  const realVis = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState').get;
  let live = false;
  const vis = () => (live || realVis.call(document) === 'visible' ? 'visible' : 'hidden');
  Object.defineProperty(document, 'visibilityState', { get: vis, configurable: true });
  Object.defineProperty(document, 'hidden', { get: () => vis() === 'hidden', configurable: true });
  window.__roIdleLive = on => {
    const before = vis();
    live = !!on;
    if (vis() !== before) document.dispatchEvent(new Event('visibilitychange'));
  };
  let last = '', lastAt = 0, streamId = null;
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
      target: s.target && typeof s.target.name === 'string'
        ? { name: s.target.name, lv: num(s.target.lv), hp: num(s.target.hp), maxHp: num(s.target.maxHp) } : null,
    };
    const key = JSON.stringify(payload);
    // Remember the character in play (per-profile storage) so auto-enter picks it next launch.
    try { localStorage.setItem('roIdleTray.lastCharacter', c.name); } catch {}
    // Re-send unchanged data after 20s so the panel's "updated" time stays honest.
    if (key === last && Date.now() - lastAt < 20000) return;
    last = key;
    lastAt = Date.now();
    console.info('[ro-idle-tray] character', payload);
    window.__TAURI_INTERNALS__?.invoke('plugin:event|emit', { event: 'ro-idle-character', payload })
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
      if (cache[id]) send(cache[id]);
      this.addEventListener('snapshot', e => {
        try { if (streamId === id) send(JSON.parse(e.data)?.snapshot); } catch {}
      });
    }
  };
  // Hidden windows skip the game's own visible-only refresh and WebKit throttles
  // their timers, so Rust calls this on its own clock (see poll_profiles).
  window.__roIdlePoll = () => {
    if (streamId !== null) window.fetch(`/api/characters/${streamId}?deferCatchup=1`, { credentials: 'same-origin' }).catch(() => {});
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
  const rowName = li => [...(li.firstElementChild?.firstElementChild?.childNodes ?? [])]
    .filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  let lastRoster = '';
  const scanRoster = () => {
    // Row markup (game's character row): li > div > [div.font-bold "name" <span>（掛機中）</span>, div "盜賊 Lv.22 / Job 8・map", div? delete notice].
    const chars = rows().map(li => {
      const [head, line, note] = li.firstElementChild?.children ?? [];
      if (!head) return null;
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
    // Last character played on this profile, else the first one.
    const li = list.find(r => rowName(r) === lastName) ?? list[0];
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
fn job_name(id: &str) -> String {
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
    notify(&app);
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
        .manage(PendingUpdate(Mutex::new(None)))
        .manage(PanelHiddenAt(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_state,
            open_account,
            toggle_idle,
            enter_character,
            add_account,
            remove_account,
            set_login,
            update_app,
            open_export_folder,
            open_atlas,
            set_nickname,
            reorder_profiles,
            quit
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let handle = app.handle().clone();

            let ids = load_profile_ids(&handle);
            app.manage(Profiles {
                ids: Mutex::new(ids.clone()),
                info: Mutex::new(HashMap::new()),
                roster: Mutex::new(HashMap::new()),
                nicknames: Mutex::new(load_nicknames(&handle)),
            });

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

            let listen_handle = handle.clone();
            app.listen("ro-idle-character", move |event| {
                let Ok(data) = serde_json::from_str::<CharacterLabel>(event.payload()) else {
                    eprintln!("[ro-idle-tray] bad character payload");
                    return;
                };
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
                    "[ro-idle-tray] {} => {name}（{class}） Base Lv{} / Job Lv{} @ {}",
                    data.profile,
                    data.base,
                    data.job,
                    data.map.as_deref().unwrap_or("?")
                );
                let profiles = listen_handle.state::<Profiles>();
                if let Some(n) = profile_number(&listen_handle, &data.profile) {
                    let mut info = data.clone();
                    info.name = name.clone();
                    info.class = class.clone();
                    info.updated = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map_or(0, |d| d.as_secs());
                    let prev = profiles.info.lock().unwrap().insert(n, info);
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
                            toast(&format!("{who}升級！"), &ups.join(" · "));
                        }
                        if p.running == Some(true) && data.running == Some(false) {
                            let at = data.map.as_deref().map_or(String::new(), |m| format!(" @ {m}"));
                            toast(&format!("{who}已停止掛機"), &format!("Base Lv{} / Job Lv{}{at}", data.base, data.job));
                        }
                    }
                    notify(&listen_handle);
                }
            });

            TrayIconBuilder::new()
                // Sleepy Jelly, black + alpha; macOS tints template icons for light/dark bars.
                .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(true)
                .tooltip("RO 放置仙境")
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_panel(tray.app_handle());
                    }
                })
                .build(app)?;
            let panel =
                WebviewWindowBuilder::new(app, "panel", WebviewUrl::App("index.html".into()))
                    .title("RO Idle Tray")
                    .inner_size(360.0, 900.0)
                    .resizable(false)
                    .decorations(false)
                    .transparent(true)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible(false)
                    // Tauri's file-drop handler swallows HTML5 drag events; the panel reorders by drag.
                    .disable_drag_drop_handler()
                    .build()?;
            let blur_handle = handle.clone();
            panel.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    hide_panel(&blur_handle);
                }
            });
            // Boot every profile hidden so it logs in, enters its first
            // character and fills the tray label without a click.
            for n in ids {
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

/// macOS banner via osascript. ponytail: shows as "Script Editor"; switch to
/// tauri-plugin-notification if the app's own name/icon matters.
fn toast(title: &str, body: &str) {
    let q = |s: &str| format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""));
    let script = format!("display notification {} with title {} sound name \"Glass\"", q(body), q(title));
    let _ = std::process::Command::new("/usr/bin/osascript").arg("-e").arg(script).spawn();
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
    let script = format!("const RO_IDLE_PROFILE = {profile:?};{CHARACTER_HOOK}");
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

/// When blur hid the panel; a tray click right after must not reopen it.
struct PanelHiddenAt(Mutex<Option<Instant>>);

fn hide_panel(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("panel") {
        let _ = w.hide();
        *app.state::<PanelHiddenAt>().0.lock().unwrap() = Some(Instant::now());
    }
    set_live(app, false);
}

fn toggle_panel(app: &AppHandle) {
    let Some(w) = app.get_webview_window("panel") else {
        return;
    };
    let just_hidden = app
        .state::<PanelHiddenAt>()
        .0
        .lock()
        .unwrap()
        .is_some_and(|t| t.elapsed() < Duration::from_millis(300));
    if w.is_visible().unwrap_or(false) {
        hide_panel(app);
    } else if !just_hidden {
        // Tall as the screen allows (below the menu bar), capped so it stays a panel.
        if let Ok(Some(m)) = w.current_monitor() {
            let screen_h = m.size().height as f64 / m.scale_factor();
            let h = (screen_h - 80.0).clamp(480.0, 1100.0);
            let _ = w.set_size(tauri::LogicalSize::new(360.0, h));
        }
        let _ = w.move_window(tauri_plugin_positioner::Position::TrayBottomCenter);
        let _ = w.show();
        let _ = w.set_focus();
        notify(app);
        poll_profiles(app);
        set_live(app, true);
    }
}

/// Panel open: game windows act visible so the game streams live (see __roIdleLive).
fn set_live(app: &AppHandle, on: bool) {
    for (label, w) in app.webview_windows() {
        if label.starts_with("game-") {
            let _ = w.eval(format!("window.__roIdleLive && window.__roIdleLive({on})"));
        }
    }
}

/// Ask every game window to re-fetch its snapshot (CHARACTER_HOOK's __roIdlePoll).
fn poll_profiles(app: &AppHandle) {
    for (label, w) in app.webview_windows() {
        if label.starts_with("game-") {
            let _ = w.eval("window.__roIdlePoll && window.__roIdlePoll()");
        }
    }
}

#[derive(serde::Serialize)]
struct ProfileView {
    n: u8,
    info: Option<CharacterLabel>,
    roster: Vec<RosterChar>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelState {
    version: String,
    autostart: bool,
    update: Option<String>,
    profiles: Vec<ProfileView>,
    nicknames: HashMap<String, String>,
}

#[tauri::command]
fn get_state(app: AppHandle) -> PanelState {
    let profiles = app.state::<Profiles>();
    let ids = profiles.ids.lock().unwrap().clone();
    let info = profiles.info.lock().unwrap();
    let roster = profiles.roster.lock().unwrap();
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
            })
            .collect(),
        nicknames: profiles.nicknames.lock().unwrap().clone(),
    }
}

#[tauri::command]
fn open_account(app: AppHandle, n: u8) {
    hide_panel(&app);
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
    hide_panel(&app);
    add_profile(&app);
}

#[tauri::command]
fn remove_account(app: AppHandle, n: u8) {
    hide_panel(&app);
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
fn export_dir() -> Option<std::path::PathBuf> {
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
    hide_panel(&app);
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

#[tauri::command]
fn open_export_folder(app: AppHandle) {
    hide_panel(&app);
    open_exports();
}
