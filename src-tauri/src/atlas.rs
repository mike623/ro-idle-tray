use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Listener, Manager};

#[derive(Default)]
pub struct MoveLock(pub tokio::sync::Mutex<()>);

#[derive(serde::Deserialize, serde::Serialize)]
pub struct MoveResult {
    profile: u8,
    name: String,
    error: Option<String>,
    /// What `call` resolved to (Merge Items collects each character's settings).
    #[serde(default, skip_serializing)]
    data: Option<serde_json::Value>,
}

/// A character currently in play, offered as a move target in the atlas.
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovableCharacter {
    profile: u8,
    name: String,
    map: Option<String>,
    running: Option<bool>,
}

fn known_map(map_id: &str) -> bool {
    let maps = include_str!("../../src/atlas-data.js")
        .lines()
        .find_map(|l| l.strip_prefix("const MAPS = "))
        .and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(s.trim_end_matches(';')).ok())
        .unwrap_or_default();
    maps.iter().any(|m| m[0].as_str() == Some(map_id))
}

fn is_atlas(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "atlas" {
        Ok(())
    } else {
        Err("Only the map explorer can move characters".into())
    }
}

/// Pick the profiles to move. `None` means every character in play.
/// An explicitly selected character must still be in play, otherwise the whole
/// request fails loudly instead of silently skipping someone.
fn select_pending<'a>(
    available: impl IntoIterator<Item = (u8, &'a str)>,
    only: Option<&BTreeSet<u8>>,
) -> Result<BTreeMap<u8, String>, String> {
    let all: BTreeMap<u8, String> = available
        .into_iter()
        .map(|(n, name)| (n, name.to_string()))
        .collect();
    let pending = match only {
        None => all,
        Some(ids) => {
            let mut pending = BTreeMap::new();
            for &n in ids {
                let name = all.get(&n).ok_or_else(|| {
                    format!("Character {n} is no longer in play; refresh and try again")
                })?;
                pending.insert(n, name.clone());
            }
            pending
        }
    };
    if pending.is_empty() {
        return Err("No characters currently in play".into());
    }
    Ok(pending)
}

fn pending_profiles(
    app: &AppHandle,
    only: Option<&BTreeSet<u8>>,
) -> Result<BTreeMap<u8, String>, String> {
    let profiles = app.state::<crate::Profiles>();
    let info = profiles.info.lock().unwrap();
    select_pending(info.iter().map(|(&n, c)| (n, c.name.as_str())), only)
}

/// Characters currently in play, newest snapshot per profile window.
#[tauri::command]
pub fn atlas_characters(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Vec<MovableCharacter>, String> {
    is_atlas(&window)?;
    let profiles = app.state::<crate::Profiles>();
    let info = profiles.info.lock().unwrap();
    let mut list: Vec<MovableCharacter> = info
        .iter()
        .map(|(&profile, c)| MovableCharacter {
            profile,
            name: c.name.clone(),
            map: c.map.clone(),
            running: c.running,
        })
        .collect();
    list.sort_by_key(|c| c.profile);
    Ok(list)
}

#[tauri::command]
pub async fn move_all(
    app: AppHandle,
    window: tauri::WebviewWindow,
    map_id: String,
) -> Result<Vec<MoveResult>, String> {
    is_atlas(&window)?;
    let lock = app.state::<MoveLock>();
    let _guard = lock
        .0
        .try_lock()
        .map_err(|_| "A move is already in progress")?;
    let pending = pending_profiles(&app, None)?;
    if !known_map(&map_id) {
        return Err("Unknown map".into());
    }
    let call = format!("window.__roIdleMove({})", serde_json::to_string(&map_id).unwrap());
    run_move(&app, &call, pending).await
}

/// Move only the characters the user selected in the atlas.
#[tauri::command]
pub async fn move_selected(
    app: AppHandle,
    window: tauri::WebviewWindow,
    map_id: String,
    profiles: Vec<u8>,
) -> Result<Vec<MoveResult>, String> {
    is_atlas(&window)?;
    let selected: BTreeSet<u8> = profiles.into_iter().collect();
    if selected.is_empty() {
        return Err("Select at least one character".into());
    }
    let lock = app.state::<MoveLock>();
    let _guard = lock
        .0
        .try_lock()
        .map_err(|_| "A move is already in progress")?;
    let pending = pending_profiles(&app, Some(&selected))?;
    if !known_map(&map_id) {
        return Err("Unknown map".into());
    }
    let call = format!("window.__roIdleMove({})", serde_json::to_string(&map_id).unwrap());
    run_move(&app, &call, pending).await
}

/// Panel's Recall button: every in-play character to its own save point (回儲存點).
#[tauri::command]
pub async fn recall_all(app: AppHandle) -> Result<Vec<MoveResult>, String> {
    let lock = app.state::<MoveLock>();
    let _guard = lock.0.try_lock().map_err(|_| "A move is already in progress")?;
    let pending = pending_profiles(&app, None)?;
    run_move(&app, "window.__roIdleRecall()", pending).await
}

/// The one merged 道具設定 file: game's own export format, so 匯入檔案 also takes it.
fn items_file() -> Result<std::path::PathBuf, String> {
    crate::export_dir()
        .map(|d| d.join("道具設定（全部角色）.ro-idle.json"))
        .ok_or_else(|| "No home folder".into())
}

/// Objects merge per key, lists union (rules matched by itemId), booleans OR,
/// other values keep the first character's (profile order).
fn merge_items(into: &mut serde_json::Value, from: &serde_json::Value) {
    use serde_json::Value;
    match (into, from) {
        (Value::Object(a), Value::Object(b)) => {
            for (k, v) in b {
                match a.get_mut(k) {
                    Some(x) => merge_items(x, v),
                    None => {
                        a.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            for v in b {
                let same = |x: &Value| match (x.get("itemId"), v.get("itemId")) {
                    (Some(p), Some(q)) => p == q,
                    _ => x == v,
                };
                if !a.iter().any(same) {
                    a.push(v.clone());
                }
            }
        }
        (Value::Bool(a), Value::Bool(b)) => *a |= *b,
        _ => {}
    }
}

/// Panel's Merge Items: every in-play character's item settings into one file.
#[tauri::command]
pub async fn items_merge(app: AppHandle) -> Result<Vec<MoveResult>, String> {
    let lock = app.state::<MoveLock>();
    let _guard = lock.0.try_lock().map_err(|_| "A move is already in progress")?;
    let pending = pending_profiles(&app, None)?;
    // Per-character overrides survive a re-merge and stay out of the shared rows.
    let overrides = items_read()
        .ok()
        .and_then(|f| f.get("overrides").filter(|o| o.is_object()).cloned())
        .unwrap_or_else(|| serde_json::json!({}));
    let call = format!("window.__roIdleItems({overrides})");
    let results = run_move(&app, &call, pending).await?;
    let mut config = serde_json::json!({});
    let (mut from, mut characters) = (Vec::new(), Vec::new());
    for r in &results {
        if let (None, Some(d)) = (&r.error, &r.data) {
            merge_items(&mut config, &d["items"]);
            from.push(r.name.clone());
            let job = d["job"].as_str().unwrap_or("");
            characters.push(serde_json::json!({"name": r.name, "job": job, "class": crate::job_name(job)}));
        }
    }
    if from.is_empty() {
        return Ok(results);
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    let file = serde_json::json!({
        "format": "ro-idle-autoconfig", "version": 1, "name": "全部角色的道具設定", "job": "",
        "exportedAt": now, "sections": ["items", "recovery"], "mergedFrom": from, "characters": characters,
        "overrides": overrides,
        "config": config,
    });
    let path = items_file()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(&file).unwrap()).map_err(|e| e.to_string())?;
    Ok(results)
}

/// Item editor window (src/items.html): the merged file, or null before the first merge.
#[tauri::command]
pub fn items_read() -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(items_file()?) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("Bad file: {e}")),
        Err(_) => Ok(serde_json::Value::Null),
    }
}

/// Item editor's 儲存: only a game-format settings file is written.
#[tauri::command]
pub fn items_save(file: serde_json::Value) -> Result<(), String> {
    if file["format"] != "ro-idle-autoconfig" || !file["config"].is_object() {
        return Err("Bad file: not an item settings file".into());
    }
    std::fs::write(items_file()?, serde_json::to_string_pretty(&file).unwrap()).map_err(|e| e.to_string())
}

/// Item editor's 套用到全部角色: the merged file's settings onto every in-play character.
#[tauri::command]
pub async fn items_apply(app: AppHandle) -> Result<Vec<MoveResult>, String> {
    let lock = app.state::<MoveLock>();
    let _guard = lock.0.try_lock().map_err(|_| "A move is already in progress")?;
    let text = std::fs::read_to_string(items_file()?).map_err(|_| "Press Merge Items first")?;
    let file: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("Bad file: {e}"))?;
    let config = file.get("config").filter(|c| c.is_object()).ok_or("Bad file: no config")?;
    let pending = pending_profiles(&app, None)?;
    let overrides = file.get("overrides").filter(|o| o.is_object()).cloned().unwrap_or_else(|| serde_json::json!({}));
    let call = format!("window.__roIdleApplyItems({config}, {overrides})");
    run_move(&app, &call, pending).await
}

/// Runs `call` (a JS promise expression) in each pending profile's game window.
async fn run_move(
    app: &AppHandle,
    call: &str,
    mut pending: BTreeMap<u8, String>,
) -> Result<Vec<MoveResult>, String> {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let event = format!("ro-idle-map-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let listener = app.listen(event.clone(), move |e| {
        if let Ok(result) = serde_json::from_str::<MoveResult>(e.payload()) {
            let _ = tx.send(result);
        }
    });
    let mut results = Vec::new();
    let event_js = serde_json::to_string(&event).unwrap();
    for (&n, name) in &pending {
        let script = format!(
            r#"(async () => {{
            let error = null, data = null;
            try {{ data = (await {call}) ?? null; }} catch(e) {{ error = String(e.message || e); }}
            await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{event:{event_js}, payload:{{profile:{n}, name:'', error, data}}}});
        }})()"#
        );
        let dispatched = app
            .get_webview_window(&format!("game-profile-{n}"))
            .ok_or_else(|| "Game window is unavailable".to_string())
            .and_then(|w| w.eval(script).map_err(|e| e.to_string()));
        if let Err(error) = dispatched {
            results.push(MoveResult {
                profile: n,
                name: name.clone(),
                error: Some(error),
                data: None,
            });
        }
    }
    for r in &results {
        pending.remove(&r.profile);
    }
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    while !pending.is_empty() {
        let Ok(Some(mut result)) = tokio::time::timeout_at(deadline, rx.recv()).await else {
            break;
        };
        if let Some(name) = pending.remove(&result.profile) {
            result.name = name;
            results.push(result);
        }
    }
    app.unlisten(listener);
    results.extend(pending.into_iter().map(|(profile, name)| MoveResult {
        profile,
        name,
        error: Some("No response; check the character's map before retrying".into()),
        data: None,
    }));
    results.sort_by_key(|r| r.profile);
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_unions_item_lists_and_keeps_first_values() {
        use serde_json::json;
        let mut m = json!({});
        merge_items(&mut m, &json!({"hpPotion": {"enabled": false, "belowPercent": 35, "items": [501]},
            "restock": [{"itemId": 501, "below": 5, "qty": 20}], "autoLoot": false}));
        merge_items(&mut m, &json!({"hpPotion": {"enabled": true, "belowPercent": 50, "items": [502, 501]},
            "restock": [{"itemId": 501, "below": 9, "qty": 9}, {"itemId": 602, "below": 1, "qty": 2}],
            "autoSell": [909], "autoLoot": true}));
        assert_eq!(m, json!({"hpPotion": {"enabled": true, "belowPercent": 35, "items": [501, 502]},
            "restock": [{"itemId": 501, "below": 5, "qty": 20}, {"itemId": 602, "below": 1, "qty": 2}],
            "autoSell": [909], "autoLoot": true}));
    }

    #[test]
    fn destinations_must_exist_in_bundled_atlas() {
        for id in ["prontera", "prt_fild08", "anthell01"] {
            assert!(known_map(id));
        }
        for id in ["", "not_a_map", "prontera\";alert(1)", "../prontera"] {
            assert!(!known_map(id));
        }
    }

    #[test]
    fn selection_keeps_only_requested_characters_in_profile_order() {
        let available = [(2, "Mage"), (1, "Knight"), (3, "Priest")];
        let selected = BTreeSet::from([3, 1]);
        let pending = select_pending(available, Some(&selected)).unwrap();
        assert_eq!(
            pending.into_iter().collect::<Vec<_>>(),
            vec![(1, "Knight".into()), (3, "Priest".into())]
        );
    }

    #[test]
    fn selection_rejects_missing_characters_and_empty_sets() {
        let available = [(1, "Knight")];
        assert!(
            select_pending(available, Some(&BTreeSet::from([1, 9])))
                .unwrap_err()
                .contains("Character 9")
        );
        assert!(
            select_pending(available, Some(&BTreeSet::new()))
                .unwrap_err()
                .contains("No characters")
        );
        assert!(
            select_pending(Vec::<(u8, &str)>::new(), None)
                .unwrap_err()
                .contains("No characters")
        );
    }

    #[test]
    fn all_in_play_are_selected_by_default() {
        let pending = select_pending([(2, "Mage"), (1, "Knight")], None).unwrap();
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[&1], "Knight");
    }
}
