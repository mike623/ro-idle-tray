//! Durable event cursor and unread alerts; no model or provider calls.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    fs, io,
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize, Deserialize)]
pub struct Alert {
    pub id: String,
    pub nudge: String,
    pub explanation: String,
}
#[derive(Default, Serialize, Deserialize)]
pub struct Alerts {
    cursor: u64,
    #[serde(default)]
    seen: BTreeSet<u64>,
    pub pending: Vec<Alert>,
    recent: Vec<Value>,
}
fn path(dir: &Path, name: &str) -> PathBuf {
    dir.join("alerts")
        .join(format!("{}.json", crate::storage::character_stem(name)))
}
fn load(dir: &Path, name: &str, now: u64) -> Result<(Vec<u8>, Alerts), String> {
    let bytes = match fs::read(path(dir, name)) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Ok((
                vec![],
                Alerts {
                    cursor: now.saturating_sub(600_000),
                    ..Default::default()
                },
            ));
        }
        Err(e) => return Err(e.to_string()),
    };
    let state = serde_json::from_slice(&bytes).map_err(|e| format!("Cannot read alerts: {e}"))?;
    Ok((bytes, state))
}
fn monster(body: &Value) -> String {
    if let Some(name) = body["monsterName"].as_str() {
        return name.into();
    }
    let Some(id) = body["monsterId"].as_u64() else {
        return String::new();
    };
    let data = crate::knowledge::lookup("monsters", &id.to_string());
    let m = &data["record"];
    m["name"]
        .as_str()
        .map(|name| format!("{name} Lv{}", m["lv"]))
        .unwrap_or_else(|| format!("怪物 #{id}"))
}
fn event_text(event: &Value) -> String {
    let b = &event["body"];
    let mut text = vec![b["type"].as_str().unwrap_or("event").to_string()];
    let monster = monster(b);
    if !monster.is_empty() {
        text.push(monster)
    }
    for key in [
        "damage",
        "skill",
        "ailment",
        "reason",
        "message",
        "hpPercent",
    ] {
        if let Some(value) = b.get(key) {
            text.push(format!(
                "{key}={}",
                value
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| value.to_string())
            ))
        }
    }
    text.join(" · ")
}
fn ingest(state: &mut Alerts, events: &[Value]) {
    for event in events {
        let (Some(wall), Some(seq)) = (event["wallMs"].as_u64(), event["seq"].as_u64()) else {
            continue;
        };
        if wall < state.cursor || (wall == state.cursor && state.seen.contains(&seq)) {
            continue;
        }
        if wall > state.cursor {
            state.cursor = wall;
            state.seen.clear();
        }
        state.seen.insert(seq);
        let body = &event["body"];
        let kind = body["type"].as_str().unwrap_or("");
        let supplies = kind == "system"
            && body["message"].as_str().is_some_and(|m| {
                m.contains("停止")
                    && (m.contains("補給") || m.contains("藥水") || m.contains("箭矢"))
            });
        if kind == "death" || kind == "stop" || supplies {
            let event_detail = event_text(event);
            let hits: Vec<_> = state
                .recent
                .iter()
                .filter(|e| e["body"]["type"] == "monsterAttack" || e["body"]["type"] == "mobSkill")
                .collect();
            let hit_damage: u64 = hits
                .iter()
                .filter_map(|e| e["body"]["damage"].as_u64())
                .sum();
            let cause = if kind == "death" {
                format!("死亡：{}", {
                    let name = monster(body);
                    if name.is_empty() {
                        body["ailment"]
                            .as_str()
                            .or_else(|| body["skill"].as_str())
                            .unwrap_or("紀錄未註明致死來源")
                            .to_string()
                    } else {
                        name
                    }
                })
            } else {
                format!(
                    "已停止：{}",
                    body["reason"]
                        .as_str()
                        .or_else(|| body["message"].as_str())
                        .unwrap_or("原因請看紀錄")
                )
            };
            let nudge = format!(
                "{}。要看紀錄嗎？",
                cause.chars().take(70).collect::<String>()
            );
            let context = state
                .recent
                .iter()
                .map(event_text)
                .collect::<Vec<_>>()
                .join("\n");
            let explanation = format!(
                "戰鬥紀錄事件（Unix 毫秒 {wall}）\n{event_detail}\n\n事件前最近 {} 筆紀錄中，有 {} 次怪物攻擊／技能紀錄，合計傷害 {hit_damage}。這是紀錄片段，不能單憑它判定唯一死因。\n{context}",
                state.recent.len(),
                hits.len()
            );
            state.pending.push(Alert {
                id: format!("{wall}:{seq}"),
                nudge,
                explanation,
            });
        }
        state.recent.push(event.clone());
        if state.recent.len() > 12 {
            state.recent.remove(0);
        }
    }
}
pub fn poll(dir: &Path, name: &str, now: u64) -> Result<Alerts, String> {
    let (previous, mut state) = load(dir, name, now)?;
    let encoded: String = name.bytes().map(|b| format!("%{b:02X}")).collect();
    let target = format!(
        "/characters/{encoded}/log?afterWallMs={}&afterSeq={}&limit=1000",
        state.cursor,
        state.seen.last().copied().unwrap_or(0)
    );
    let (status, body) = crate::api::respond(
        "GET",
        &target,
        Some("Bearer internal"),
        "internal",
        dir,
        now,
    );
    if status != 200 {
        return Err(body["error"]
            .as_str()
            .unwrap_or("Cannot read character log")
            .into());
    }
    if let Some(events) = body["events"].as_array() {
        ingest(&mut state, events)
    }
    let bytes = serde_json::to_vec(&state).map_err(|e| e.to_string())?;
    if bytes != previous {
        crate::storage::write_private_atomic(&path(dir, name), &previous, &bytes)?;
    }
    Ok(state)
}
pub fn acknowledge(dir: &Path, name: &str, now: u64, ids: &[String]) -> Result<(), String> {
    let (previous, mut state) = load(dir, name, now)?;
    state.pending.retain(|a| !ids.contains(&a.id));
    crate::storage::write_private_atomic(
        &path(dir, name),
        &previous,
        &serde_json::to_vec(&state).map_err(|e| e.to_string())?,
    )
}
pub fn badge(state: &Alerts) -> Value {
    json!({"unread":state.pending.len(),"nudge":state.pending.last().map(|a|a.nudge.as_str()).unwrap_or("")})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unread_badges_survive_restart_and_acknowledgement_is_character_specific() {
        let dir = std::env::temp_dir().join(format!("ro-alerts-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("logs")).unwrap();
        fs::write(
            dir.join("characters.json"),
            r#"{"1":{"name":"Alice"},"2":{"name":"Bob"}}"#,
        )
        .unwrap();
        let now = 1_793_577_600_000u64;
        let events = json!([{"wallMs":now-1000,"seq":1,"body":{"type":"death","monsterId":1014}}]);
        fs::write(
            dir.join("logs/Alice-2026-11-02.log"),
            format!("{}\tAlice\t{events}\n", now / 1000),
        )
        .unwrap();
        assert_eq!(badge(&poll(&dir, "Alice", now).unwrap())["unread"], 1);
        assert_eq!(badge(&poll(&dir, "Alice", now).unwrap())["unread"], 1);
        assert_eq!(badge(&poll(&dir, "Bob", now).unwrap())["unread"], 0);
        acknowledge(&dir, "Alice", now, &[format!("{}:1", now - 1000)]).unwrap();
        assert_eq!(badge(&poll(&dir, "Alice", now).unwrap())["unread"], 0);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn full_timestamp_page_does_not_hide_later_alerts() {
        let dir = std::env::temp_dir().join(format!("ro-alert-page-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("logs")).unwrap();
        fs::write(dir.join("characters.json"), r#"{"1":{"name":"Alice"}}"#).unwrap();
        let now = 1_793_577_600_000u64;
        let events:Vec<_>=(1..=1001).map(|seq|json!({"wallMs":now-1000,"seq":seq,"body":{"type":if seq==1001{"death"}else{"searching"}}})).collect();
        fs::write(
            dir.join("logs/Alice-2026-11-02.log"),
            format!("{}\tAlice\t{}\n", now / 1000, json!(events)),
        )
        .unwrap();
        assert_eq!(poll(&dir, "Alice", now).unwrap().pending.len(), 0);
        assert_eq!(poll(&dir, "Alice", now).unwrap().pending.len(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn death_stop_and_supply_halt_are_unique_with_log_causes() {
        let events = vec![
            json!({"wallMs":1,"seq":1,"body":{"type":"monsterAttack","monsterId":1014,"damage":48}}),
            json!({"wallMs":2,"seq":2,"body":{"type":"death","monsterId":1014,"damage":48}}),
            json!({"wallMs":2,"seq":3,"body":{"type":"stop","reason":"DEATH"}}),
            json!({"wallMs":3,"seq":4,"body":{"type":"system","message":"補給不足，停止掛機"}}),
        ];
        let mut state = Alerts::default();
        ingest(&mut state, &events);
        assert_eq!(state.pending.len(), 3);
        assert!(state.pending[0].nudge.contains("魔菇"));
        assert!(state.pending[0].explanation.contains("合計傷害 48"));
        let bytes = serde_json::to_vec(&state).unwrap();
        let mut reloaded = serde_json::from_slice(&bytes).unwrap();
        ingest(&mut reloaded, &events);
        assert_eq!(reloaded.pending.len(), 3);
        reloaded.pending.clear();
        ingest(&mut reloaded, &events);
        assert_eq!(badge(&reloaded)["unread"], 0);
    }
}
