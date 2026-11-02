use std::sync::Mutex;
use std::sync::atomic::{AtomicU8, Ordering};
use tauri::{
    AppHandle, Listener, Manager, WebviewUrl, WebviewWindowBuilder, Wry,
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_positioner::WindowExt;
use tauri_plugin_updater::{Update, UpdaterExt};

// Runs before the game bundle. The game calls global fetch for
// GET /api/characters/{id}?deferCatchup=1 and opens a global EventSource on
// /api/characters/{id}/stream whose `snapshot` events carry live levels. Both
// payloads hold snapshot.character.{name,baseLv,jobLv}.
const CHARACTER_HOOK: &str = r#"
(() => {
  let last = '', streamId = null;
  const cache = {};
  const send = c => {
    if (!c || typeof c.name !== 'string' || !Number.isInteger(c.baseLv) || !Number.isInteger(c.jobLv)) return;
    const payload = { profile: RO_IDLE_PROFILE, name: c.name, class: typeof c.job === 'string' ? c.job : '', base: c.baseLv, job: c.jobLv };
    const key = JSON.stringify(payload);
    if (key === last) return;
    last = key;
    console.info('[ro-idle-tray] character', payload);
    window.__TAURI_INTERNALS__?.invoke('plugin:event|emit', { event: 'ro-idle-character', payload })
      .catch(e => console.warn('[ro-idle-tray] emit failed', e));
  };
  const origFetch = window.fetch;
  window.fetch = function (input) {
    const p = origFetch.apply(this, arguments);
    const id = (String(input?.url ?? input).match(/\/api\/characters\/([^/?]+)\?deferCatchup/) || [])[1];
    if (id) p.then(r => r.ok ? r.clone().json() : null).then(d => {
      const c = d?.snapshot?.character;
      if (!c) return;
      cache[id] = c;
      // ponytail: other-character previews hit the same URL; only trust the streamed one.
      if (streamId === null || streamId === id) send(c);
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
        try { if (streamId === id) send(JSON.parse(e.data)?.snapshot?.character); } catch {}
      });
    }
  };
  // Auto-enter the first playable character once per page load (select screen
  // is a list `ul[aria-label="角色列表"]`, each row's primary button is 進入).
  let entered = false;
  const tryEnter = () => {
    if (entered) return;
    const btn = [...document.querySelectorAll('ul[aria-label="角色列表"] li button.xp-btn.primary')]
      .find(b => !b.disabled && b.textContent.trim() === '進入');
    if (!btn) return;
    entered = true;
    obs.disconnect();
    console.info('[ro-idle-tray] auto-enter first character');
    btn.click();
  };
  const obs = new MutationObserver(tryEnter);
  const start = () => {
    obs.observe(document.documentElement, { childList: true, subtree: true });
    // ponytail: give up after 2 min so a later manual "switch character" isn't hijacked.
    setTimeout(() => { entered = true; obs.disconnect(); }, 120000);
    tryEnter();
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
"#;

struct Profiles {
    count: AtomicU8,
    menu: Menu<Wry>,
}

#[derive(serde::Deserialize)]
struct CharacterLabel {
    profile: String,
    name: String,
    #[serde(default)]
    class: String,
    base: u32,
    job: u32,
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

fn count_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("profile-count"))
}

fn profile_item(app: &AppHandle, n: u8) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(
        app,
        format!("profile-{n}"),
        format!("RO放置仙境 — Account {n}"),
        true,
        None::<&str>,
    )
}

/// Returns the profile number when `id` is `profile-N` and N exists.
fn profile_number(app: &AppHandle, id: &str) -> Option<u8> {
    let n: u8 = id.strip_prefix("profile-")?.parse().ok()?;
    let count = app.state::<Profiles>().count.load(Ordering::SeqCst);
    (1..=count).contains(&n).then_some(n)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PendingUpdate(Mutex::new(None)))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let handle = app.handle().clone();

            let count = count_file(&handle)
                .and_then(|f| std::fs::read_to_string(f).ok())
                .and_then(|s| s.trim().parse::<u8>().ok())
                .filter(|n| *n >= 1)
                .unwrap_or(2);

            let menu = Menu::new(app)?;
            for n in 1..=count {
                menu.append(&profile_item(&handle, n)?)?;
            }
            menu.append(&PredefinedMenuItem::separator(app)?)?;
            menu.append(&MenuItem::with_id(
                app,
                "add-profile",
                "Add Profile…",
                true,
                None::<&str>,
            )?)?;
            menu.append(&CheckMenuItem::with_id(
                app,
                "autostart",
                "Start at Login",
                true,
                launch_agent_path().is_some_and(|p| p.exists()),
                None::<&str>,
            )?)?;
            menu.append(&MenuItem::with_id(
                app,
                "version",
                format!("RO Idle Tray v{}", app.package_info().version),
                false,
                None::<&str>,
            )?)?;
            menu.append(&MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?)?;
            app.manage(Profiles {
                count: AtomicU8::new(count),
                menu: menu.clone(),
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
                let text = if class.is_empty() {
                    format!("{name} — Base Lv{} / Job Lv{}", data.base, data.job)
                } else {
                    format!(
                        "{name}（{class}） — Base Lv{} / Job Lv{}",
                        data.base, data.job
                    )
                };
                eprintln!("[ro-idle-tray] {} => {text}", data.profile);
                let menu = &listen_handle.state::<Profiles>().menu;
                if let Some(item) = menu
                    .get(&data.profile)
                    .and_then(|k| k.as_menuitem().cloned())
                {
                    let _ = item.set_text(text);
                }
            });

            TrayIconBuilder::new()
                .icon(Image::new_owned(
                    vec![
                        40, 160, 240, 255, 40, 160, 240, 255, 40, 160, 240, 255, 40, 160, 240, 255,
                        40, 160, 240, 255, 255, 255, 255, 255, 255, 255, 255, 255, 40, 160, 240,
                        255, 40, 160, 240, 255, 40, 160, 240, 255, 255, 255, 255, 255, 255, 255,
                        255, 255, 40, 160, 240, 255, 40, 160, 240, 255, 40, 160, 240, 255, 40, 160,
                        240, 255,
                    ],
                    4,
                    4,
                ))
                .icon_as_template(false)
                .tooltip("RO 放置仙境")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "add-profile" => add_profile(app),
                    "autostart" => toggle_autostart(app),
                    "update" => install_update(app),
                    id => open_profile(app, id, true),
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        open_profile(tray.app_handle(), "profile-1", true);
                    }
                })
                .build(app)?;
            // Boot every profile hidden so it logs in, enters its first
            // character and fills the tray label without a click.
            for n in 1..=count {
                open_profile(&handle, &format!("profile-{n}"), false);
            }
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
    let menu = &app.state::<Profiles>().menu;
    let Some(item) = menu
        .get("autostart")
        .and_then(|k| k.as_check_menuitem().cloned())
    else {
        return;
    };
    let want = launch_agent_path().is_none_or(|p| !p.exists());
    let result = set_autostart(want);
    if let Err(e) = &result {
        eprintln!("[ro-idle-tray] autostart: {e}");
    }
    // Reflect the file on disk, whatever the click toggled.
    let _ = item.set_checked(launch_agent_path().is_some_and(|p| p.exists()));
}

fn add_profile(app: &AppHandle) {
    let profiles = app.state::<Profiles>();
    let n = profiles.count.load(Ordering::SeqCst);
    let Some(next) = n.checked_add(1) else { return };
    let Ok(item) = profile_item(app, next) else {
        return;
    };
    if profiles.menu.insert(&item, n as usize).is_err() {
        return;
    }
    profiles.count.store(next, Ordering::SeqCst);
    if let Some(file) = count_file(app) {
        let _ = std::fs::create_dir_all(file.parent().unwrap());
        if let Err(e) = std::fs::write(&file, next.to_string()) {
            eprintln!("[ro-idle-tray] cannot save profile count: {e}");
        }
    }
    open_profile(app, &format!("profile-{next}"), true);
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
    .initialization_script(script);
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

/// Checks GitHub for a newer release and, if found, shows "Update to vX…" in the tray.
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
    let text = format!("Update to v{}…", update.version);
    *app.state::<PendingUpdate>().0.lock().unwrap() = Some(update);
    let menu = &app.state::<Profiles>().menu;
    if let Some(item) = menu.get("update").and_then(|k| k.as_menuitem().cloned()) {
        let _ = item.set_text(text);
        return;
    }
    let Ok(item) = MenuItem::with_id(app, "update", text, true, None::<&str>) else {
        return;
    };
    // Above the version label and Quit.
    let pos = menu.items().map_or(0, |i| i.len().saturating_sub(2));
    if let Err(e) = menu.insert(&item, pos) {
        eprintln!("[ro-idle-tray] update menu: {e}");
    }
}

fn install_update(app: &AppHandle) {
    let Some(update) = app.state::<PendingUpdate>().0.lock().unwrap().take() else {
        return;
    };
    if let Some(item) = app
        .state::<Profiles>()
        .menu
        .get("update")
        .and_then(|k| k.as_menuitem().cloned())
    {
        let _ = item.set_text("Updating…");
        let _ = item.set_enabled(false);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match update.download_and_install(|_, _| {}, || {}).await {
            Ok(()) => app.restart(),
            Err(e) => {
                eprintln!("[ro-idle-tray] update install: {e}");
                if let Some(item) = app
                    .state::<Profiles>()
                    .menu
                    .get("update")
                    .and_then(|k| k.as_menuitem().cloned())
                {
                    let _ = item.set_text(format!("Update to v{}…", update.version));
                    let _ = item.set_enabled(true);
                }
                *app.state::<PendingUpdate>().0.lock().unwrap() = Some(update);
            }
        }
    });
}
