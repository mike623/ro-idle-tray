//! Battle view (src/battle.html): a side-view replay of a party's live battle log,
//! drawn with the original RO client art.
//!
//! Gravity's art is never bundled. `roasset://localhost/<host>/<path>` fetches it from
//! one of the public mirrors below on first use and keeps a copy in the app cache dir,
//! so a map that was watched (or pre-downloaded) once also works offline.

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Hosts the asset scheme may fetch from, each limited to the paths the view uses.
const MIRRORS: &[(&str, &str)] = &[
    ("assets.latam-tools.com.br", "/image"),           // zrenderer: job/monster sprites as APNG
    ("ro-idle.app", "/client/"),                        // map backdrops, item and skill icons
    ("ro-survivors.com", "/assets/"),                   // effect atlases and STR effects
    ("cdn.jsdelivr.net", "/gh/GodLesZ/rangarok-js@"),   // client basic_interface window textures
];

/// `/<host>/<path>` + query -> the remote URL, when the host and path are allowed.
pub(crate) fn remote_url(path: &str, query: Option<&str>) -> Option<String> {
    let rest = path.strip_prefix('/')?;
    let (host, tail) = rest.split_once('/')?;
    let tail = format!("/{tail}");
    let ok = MIRRORS.iter().any(|(h, p)| *h == host && tail.starts_with(p));
    if !ok || tail.contains("..") {
        return None;
    }
    Some(match query.filter(|q| !q.is_empty()) {
        Some(q) => format!("https://{host}{tail}?{q}"),
        None => format!("https://{host}{tail}"),
    })
}

fn cache_file(dir: &Path, url: &str) -> PathBuf {
    let hash = Sha256::digest(url.as_bytes());
    let name: String = hash.iter().take(16).map(|b| format!("{b:02x}")).collect();
    dir.join(&name[..2]).join(name)
}

/// Cached bytes + content type, fetching and storing them on a miss.
async fn asset(dir: PathBuf, url: String) -> Result<(Vec<u8>, String), String> {
    let file = cache_file(&dir, &url);
    let type_file = file.with_extension("type");
    if let (Ok(body), Ok(kind)) = (std::fs::read(&file), std::fs::read_to_string(&type_file)) {
        return Ok((body, kind));
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let kind = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let body = response.bytes().await.map_err(|e| e.to_string())?.to_vec();
    if body.len() > 8_000_000 {
        return Err("asset too large".into());
    }
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // Body first: a reader only trusts the pair once the .type file exists.
    let _ = std::fs::write(&file, &body).and_then(|_| std::fs::write(&type_file, &kind));
    Ok((body, kind))
}

/// Handler for `roasset://localhost/<host>/<path>?<query>`.
pub fn protocol<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let dir = ctx.app_handle().path().app_cache_dir().map(|d| d.join("battle-assets"));
    let url = remote_url(request.uri().path(), request.uri().query());
    tauri::async_runtime::spawn(async move {
        let reply = |status: u16, kind: &str, body: Vec<u8>| {
            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", kind)
                .header("Access-Control-Allow-Origin", "*")
                .body(body)
                .unwrap()
        };
        let (Ok(dir), Some(url)) = (dir, url) else {
            return responder.respond(reply(403, "text/plain", b"not an allowed asset".to_vec()));
        };
        match asset(dir, url).await {
            Ok((body, kind)) => responder.respond(reply(200, &kind, body)),
            Err(e) => responder.respond(reply(502, "text/plain", e.into_bytes())),
        }
    });
}

/// Character the battle view is watching; its party is held online while the view is open.
static FOCUS: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// Profile numbers of the watched party (empty when the view is closed or hidden).
pub(crate) fn held_profiles(app: &AppHandle) -> Vec<u8> {
    let shown = app.get_webview_window("battle").is_some_and(|w| w.is_visible().unwrap_or(false));
    let focus = FOCUS.lock().unwrap().clone();
    if !shown || focus.is_empty() {
        return vec![];
    }
    profile_numbers(&same_map(crate::battle_roster(app), &focus))
}

/// WebKit suspends hidden game windows, so their battle-log stream events queue up and
/// land in a clump at the 30 s poll (measured 2026-11-04: newest event up to 26 s old on
/// arrival). While the view is open, nudge the watched windows every second so each
/// server batch (~6 s of events) is delivered as it arrives.
fn start_poke(app: &AppHandle) {
    static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        for n in held_profiles(&app) {
            if let Some(w) = app.get_webview_window(&format!("game-profile-{n}")) {
                let _ = w.eval("void 0");
            }
        }
    });
}

fn profile_numbers(party: &[Value]) -> Vec<u8> {
    party.iter().filter_map(|c| c["profile"].as_str()?.strip_prefix("profile-")?.parse().ok()).collect()
}

/// Opens (or focuses) the battle view on `name`'s party and brings that party online:
/// offline (auto offline) windows send no live events, so the view would stand still.
#[tauri::command]
pub fn open_battle(app: AppHandle, name: Option<String>) {
    start_poke(&app);
    if let Some(n) = name.as_deref().filter(|n| !n.is_empty()) {
        *FOCUS.lock().unwrap() = n.to_string();
        for p in profile_numbers(&same_map(crate::battle_roster(&app), n)) {
            crate::set_offline(&app, p, false);
        }
    }
    let name_js = serde_json::to_string(&name.unwrap_or_default()).unwrap_or_else(|_| "\"\"".into());
    if let Some(w) = app.get_webview_window("battle") {
        let _ = w.eval(format!("window.battleFocus && window.battleFocus({name_js})"));
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(&app, "battle", WebviewUrl::App("battle.html".into()))
        .title("RO 戰鬥畫面")
        .inner_size(980.0, 640.0)
        .min_inner_size(560.0, 360.0)
        .initialization_script(format!("window.BATTLE_FOCUS = {name_js};"))
        .build();
}

/// Characters loaded in the tray, for the view's party roster: every character on the
/// same map as `name` (the game has no party list in its snapshot; same map is the party).
#[tauri::command]
pub fn battle_party(app: AppHandle, name: String) -> Vec<Value> {
    same_map(crate::battle_roster(&app), &name)
}

/// `name` plus everyone on its map: by map id, or by the displayed map name for
/// snapshots from before the hook sent ids. Characters in town or offline drop out.
pub(crate) fn same_map(all: Vec<Value>, name: &str) -> Vec<Value> {
    let key = |c: &Value| c["mapId"].as_str().or(c["map"].as_str()).map(str::to_string);
    let map = all.iter().find(|c| c["name"] == name).and_then(key);
    all.into_iter().filter(|c| c["name"] == name || (map.is_some() && key(c) == map)).collect()
}

/// Bytes read from the end of a log file for the backfill. A minute of a busy party
/// is ~150 KB per character, so this covers the last few minutes.
const TAIL_BYTES: u64 = 1_500_000;

/// Recent events for each name (today's mirrored log, last `TAIL_BYTES`), oldest first.
#[tauri::command]
pub fn battle_backfill(app: AppHandle, names: Vec<String>) -> serde_json::Map<String, Value> {
    let Ok(logs) = app.path().app_config_dir().map(|d| d.join("logs")) else { return Default::default() };
    names
        .into_iter()
        .take(12)
        .map(|n| {
            let events = tail_events(&logs, &n, TAIL_BYTES);
            (n, Value::Array(events))
        })
        .collect()
}

pub(crate) fn tail_events(logs: &Path, name: &str, max: u64) -> Vec<Value> {
    use std::io::{Read, Seek, SeekFrom};
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let path = logs.join(format!("{}-{}.log", crate::api::log_stem(name), crate::utc_date(ts)));
    let Ok(mut f) = std::fs::File::open(path) else { return vec![] };
    let len = f.metadata().map_or(0, |m| m.len());
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(max)));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    // Drop the partial first line when the read started mid-file.
    let text = if len > max { text.split_once('\n').map_or("", |(_, rest)| rest) } else { &text };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    crate::api::parse_events(text, 0, &mut seen, &mut out);
    out.sort_by_key(|e| (e["simTime"].as_u64().unwrap_or(0), e["seq"].as_u64().unwrap_or(0)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_allowed_mirrors() {
        assert_eq!(
            remote_url("/assets.latam-tools.com.br/image", Some("job=1&action=6")).as_deref(),
            Some("https://assets.latam-tools.com.br/image?job=1&action=6")
        );
        assert_eq!(remote_url("/ro-idle.app/client/item/501.png", None).as_deref(), Some("https://ro-idle.app/client/item/501.png"));
        assert!(remote_url("/ro-idle.app/api/characters", None).is_none());
        assert!(remote_url("/evil.com/assets/x", None).is_none());
        assert!(remote_url("/ro-survivors.com/assets/../secret", None).is_none());
    }

    #[test]
    fn party_is_everyone_on_the_same_map() {
        let all = vec![
            serde_json::json!({"name": "A", "mapId": "mjolnir_09"}),
            serde_json::json!({"name": "B", "mapId": "mjolnir_09"}),
            serde_json::json!({"name": "C", "mapId": "prt_fild08"}),
            serde_json::json!({"name": "D", "map": "普隆德拉原野 08"}),
            serde_json::json!({"name": "E", "map": "普隆德拉原野 08"}),
        ];
        let names = |v: Vec<Value>| v.iter().map(|c| c["name"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(names(same_map(all.clone(), "A")), ["A", "B"]);
        assert_eq!(names(same_map(all.clone(), "D")), ["D", "E"]);
        assert_eq!(names(same_map(all, "Z")), Vec::<String>::new());
        let party = vec![serde_json::json!({"profile": "profile-3"}), serde_json::json!({"profile": "x"}), serde_json::json!({"profile": "profile-11"})];
        assert_eq!(profile_numbers(&party), [3, 11]);
    }

    #[test]
    fn tail_skips_partial_line_and_sorts_by_sim_time() {
        let dir = std::env::temp_dir().join(format!("battle-tail-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        let line = |seq: u64, sim: u64| {
            format!("{ts}\tA\t[{{\"seq\":{seq},\"wallMs\":{},\"simTime\":{sim},\"body\":{{\"type\":\"kill\"}}}}]\n", 1000 + seq)
        };
        let text = format!("{}{}{}", line(1, 30), line(2, 10), line(3, 20));
        std::fs::write(dir.join(format!("A-{}.log", crate::utc_date(ts))), &text).unwrap();
        let all: Vec<u64> = tail_events(&dir, "A", 1 << 20).iter().map(|e| e["simTime"].as_u64().unwrap()).collect();
        assert_eq!(all, vec![10, 20, 30]);
        // Starting mid-line drops that line instead of mis-parsing it.
        let cut = (text.len() - line(3, 20).len() - 5) as u64;
        assert_eq!(tail_events(&dir, "A", cut).len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }
}
