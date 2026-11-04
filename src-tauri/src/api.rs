//! Local read-only character API (issue #1).
//!
//! A tiny HTTP/1.1 server on 127.0.0.1 that serves what the tray already writes to
//! disk: `characters.json` (latest snapshot per profile) and the mirrored battle logs
//! in `logs/<char>-YYYY-MM-DD.log`. It never touches tray or game state; every
//! endpoint is a GET that only reads files.
//!
//! Auth: every request needs `Authorization: Bearer <token>`. The token is generated
//! at first start and stored, with the port, in `<app_config_dir>/api.json` (0600):
//!
//! ```sh
//! CFG=~/Library/Application\ Support/com.mikewong.ro-idle-tray/api.json
//! curl -H "Authorization: Bearer $(jq -r .token "$CFG")" "$(jq -r .url "$CFG")/characters"
//! ```
//!
//! Endpoints (names are URL-encoded character names):
//! - `GET /characters` — every character's latest snapshot, plus `profile`, and `goal` /
//!   `nickname` (string or null) from goals.json / nicknames.json
//! - `GET /characters/{name}` — one character's latest snapshot
//! - `GET /characters/{name}/log?since=<unix secs>&limit=<n>` — raw log events after `since`
//! - `GET /characters/{name}/summary?minutes=<n>` — battle summary for the last n minutes
//!
//! The one write, kept out of `respond` so the assistant's read tools can never reach it:
//! - `POST /online` / `POST /offline` (optional `?profile=<n>`, default every profile) —
//!   same as the panel's All Online switch / right-click menu

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Set by lib.rs: (profile or None = all, offline) -> false when the profile doesn't exist.
pub static ONLINE_HOOK: std::sync::OnceLock<Box<dyn Fn(Option<u8>, bool) -> bool + Send + Sync>> = std::sync::OnceLock::new();

/// `POST /online|/offline[?profile=N]`.
fn toggle(target: &str, auth: Option<&str>, token: &str) -> Option<(u16, Value)> {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let off = match path { "/offline" => true, "/online" => false, _ => return None };
    if !authorized(auth, token) {
        return Some(err(401, "missing or wrong bearer token"));
    }
    let profile = match query.split('&').find_map(|kv| kv.strip_prefix("profile=")) {
        None => None,
        Some(n) => match n.parse::<u8>() { Ok(n) => Some(n), Err(_) => return Some(err(400, "profile must be a number")) },
    };
    let Some(hook) = ONLINE_HOOK.get() else { return Some(err(404, "no such endpoint")) };
    if !hook(profile, off) {
        return Some(err(404, "unknown profile"));
    }
    Some((200, json!({ "ok": true, "offline": off, "profile": profile })))
}

pub const DEFAULT_PORT: u16 = 47615;
const MAX_MINUTES: u64 = 3 * 24 * 60; // logs are kept 3 days
const DEFAULT_LIMIT: usize = 1000;
const MAX_LIMIT: usize = 10_000;

#[derive(Serialize, Deserialize)]
struct ApiConfig {
    url: String,
    port: u16,
    token: String,
}

/// Log file stem for a character name. Must match the `stem` rule in lib.rs's
/// `ro-idle-log` mirror (kept there inline so this module stays self-contained).
pub(crate) fn log_stem(name: &str) -> String {
    name.chars().map(|c| if c.is_control() || "/\\:".contains(c) { '_' } else { c }).collect()
}

/// Start the API on a background thread, serving files under `dir` (app_config_dir).
pub fn start(dir: PathBuf) {
    std::thread::spawn(move || {
        if let Err(e) = serve(&dir) {
            eprintln!("[ro-idle-tray] api: {e}");
        }
    });
}

fn serve(dir: &Path) -> io::Result<()> {
    let cfg_path = dir.join("api.json");
    let saved: Option<ApiConfig> =
        std::fs::read_to_string(&cfg_path).ok().and_then(|s| serde_json::from_str(&s).ok());
    let token = saved.as_ref().map(|c| c.token.clone()).filter(|t| t.len() >= 32).unwrap_or_else(new_token);
    let listener = bind(saved.as_ref().map_or(DEFAULT_PORT, |c| c.port))?;
    let port = listener.local_addr()?.port();
    let cfg = ApiConfig { url: format!("http://127.0.0.1:{port}"), port, token: token.clone() };
    write_private(&cfg_path, &serde_json::to_string_pretty(&cfg).unwrap_or_default())?;
    eprintln!("[ro-idle-tray] api listening on {} (token in {})", cfg.url, cfg_path.display());
    for stream in listener.incoming().flatten() {
        let (dir, token) = (dir.to_path_buf(), token.clone());
        std::thread::spawn(move || {
            let _ = handle_conn(stream, &dir, &token);
        });
    }
    Ok(())
}

/// Loopback only: the wanted port, or any free one if it is taken.
fn bind(port: u16) -> io::Result<TcpListener> {
    TcpListener::bind(("127.0.0.1", port)).or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
}

fn write_private(path: &Path, text: &str) -> io::Result<()> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
    let mut f = opts.open(path)?;
    // mode() only applies on create; tighten an existing file too.
    #[cfg(unix)]
    f.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    f.write_all(text.as_bytes())
}

/// 256-bit hex token from the OS RNG (std's randomly seeded hasher as a fallback).
fn new_token() -> String {
    let mut buf = [0u8; 32];
    let ok = std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut buf)).is_ok();
    if !ok {
        use std::hash::{BuildHasher, Hasher};
        for chunk in buf.chunks_mut(8) {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
            chunk.copy_from_slice(&h.finish().to_le_bytes());
        }
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn handle_conn(stream: TcpStream, dir: &Path, token: &str) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?.take(16 * 1024));
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut auth = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 || line.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("authorization") {
                auth = Some(v.trim().to_string());
            }
        }
    }
    let mut parts = request_line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or("/"));
    let (status, body) = (method == "POST")
        .then(|| toggle(target, auth.as_deref(), token))
        .flatten()
        .unwrap_or_else(|| respond(method, target, auth.as_deref(), token, dir, now_ms()));
    let body = body.to_string();
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let mut out = stream;
    write!(
        out,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n{}\r\n{body}",
        body.len(),
        if status == 401 { "WWW-Authenticate: Bearer\r\n" } else { "" },
    )?;
    out.flush()
}

fn authorized(header: Option<&str>, token: &str) -> bool {
    let Some(given) = header.and_then(|h| h.strip_prefix("Bearer ")).map(str::trim) else { return false };
    // Constant-time compare (lengths are not secret).
    given.len() == token.len() && given.bytes().zip(token.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn err(status: u16, msg: &str) -> (u16, Value) {
    (status, json!({ "error": msg }))
}

/// Pure request router: (method, target, Authorization header) -> (status, JSON body).
pub(crate) fn respond(method: &str, target: &str, auth: Option<&str>, token: &str, dir: &Path, now_ms: u64) -> (u16, Value) {
    if !authorized(auth, token) {
        return err(401, "missing or wrong bearer token");
    }
    if method != "GET" {
        return err(405, "read-only API: GET only");
    }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let q: BTreeMap<String, String> = query
        .split('&')
        .filter_map(|kv| kv.split_once('=').map(|(k, v)| (k.to_string(), percent_decode(v).unwrap_or_default())))
        .collect();
    let Some(segs) = path.split('/').filter(|s| !s.is_empty()).map(percent_decode).collect::<Option<Vec<_>>>() else {
        return err(400, "bad path encoding");
    };
    let segs: Vec<&str> = segs.iter().map(String::as_str).collect();
    match segs.as_slice() {
        ["characters"] => (200, Value::Array(load_characters(dir))),
        ["characters", name] => match find_character(dir, name) {
            Some(c) => (200, c),
            None => err(404, "unknown character"),
        },
        ["characters", name, "log"] => {
            let Some(since) = q.get("since").map_or(Some(0.0), |s| s.parse::<f64>().ok()).filter(|s| *s >= 0.0) else {
                return err(400, "since must be unix seconds");
            };
            let limit = q.get("limit").and_then(|l| l.parse().ok()).unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
            let since_ms = (since * 1000.0) as u64;
            let cursor = match (q.get("afterWallMs"), q.get("afterSeq")) {
                (None,None) => None,
                (Some(wall),Some(seq)) => match (wall.parse::<u64>(),seq.parse::<u64>()) { (Ok(w),Ok(s)) => Some((w,s)), _ => return err(400,"afterWallMs and afterSeq must be unsigned integers") },
                _ => return err(400,"afterWallMs and afterSeq must be provided together"),
            };
            let from = cursor.map_or(since_ms, |(wall,_)|wall.saturating_sub(1));
            let Some(mut events) = character_events(dir, name, from) else {
                return err(404, "unknown character");
            };
            if let Some(cursor)=cursor { events.retain(|e|(e["wallMs"].as_u64().unwrap_or(0),e["seq"].as_u64().unwrap_or(0))>cursor); }
            let truncated = events.len() > limit;
            events.truncate(limit);
            (200, json!({ "character": name, "since": since, "truncated": truncated, "events": events }))
        }
        ["characters", name, "summary"] => {
            let Some(minutes) = q.get("minutes").map_or(Some(60), |m| m.parse::<u64>().ok()) else {
                return err(400, "minutes must be a whole number");
            };
            let minutes = minutes.clamp(1, MAX_MINUTES);
            let from_ms = now_ms.saturating_sub(minutes * 60_000);
            let Some(events) = character_events(dir, name, from_ms.saturating_sub(1)) else {
                return err(404, "unknown character");
            };
            let mut body = serde_json::to_value(summarize(&events)).unwrap_or_default();
            if let Value::Object(m) = &mut body {
                m.insert("character".into(), json!(name));
                m.insert("minutes".into(), json!(minutes));
                m.insert("fromMs".into(), json!(from_ms));
                m.insert("toMs".into(), json!(now_ms));
            }
            (200, body)
        }
        _ => err(404, "no such endpoint"),
    }
}

/// characters.json is `{ "<profile>": snapshot }`; flatten to a list sorted by profile.
pub(crate) fn load_characters(dir: &Path) -> Vec<Value> {
    let Some(Value::Object(all)) =
        std::fs::read_to_string(dir.join("characters.json")).ok().and_then(|s| serde_json::from_str(&s).ok())
    else {
        return Vec::new();
    };
    let (goals, nicknames) = (name_map(dir, "goals.json"), name_map(dir, "nicknames.json"));
    let mut list: Vec<(u64, Value)> = all
        .into_iter()
        .map(|(k, mut v)| {
            let n = k.parse().unwrap_or(u64::MAX);
            if let Value::Object(m) = &mut v {
                let name = m.get("name").and_then(Value::as_str).unwrap_or("");
                let (goal, nickname) = (goals.get(name).cloned(), nicknames.get(name).cloned());
                m.insert("profile".into(), json!(n));
                m.insert("goal".into(), json!(goal));
                m.insert("nickname".into(), json!(nickname));
            }
            (n, v)
        })
        .collect();
    list.sort_by_key(|(n, _)| *n);
    list.into_iter().map(|(_, v)| v).collect()
}

/// goals.json / nicknames.json: `{ "<character name>": "<text>" }`; empty values count as unset.
fn name_map(dir: &Path, file: &str) -> BTreeMap<String, String> {
    let map: BTreeMap<String, String> =
        std::fs::read_to_string(dir.join(file)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    map.into_iter().filter(|(_, v)| !v.trim().is_empty()).collect()
}

fn find_character(dir: &Path, name: &str) -> Option<Value> {
    load_characters(dir).into_iter().find(|c| c["name"] == name)
}

/// This character's daily log files dated on/after `min_date` (YYYY-MM-DD), oldest first.
/// Exact stem match so `嘈嘈嘈` never picks up `嘈嘈嘈2-…`.
fn log_files(logs: &Path, name: &str, min_date: &str) -> Vec<PathBuf> {
    let prefix = format!("{}-", log_stem(name));
    let mut files: Vec<(String, PathBuf)> = std::fs::read_dir(logs)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|f| {
            let file = f.file_name().into_string().ok()?;
            let date = file.strip_prefix(&prefix)?.strip_suffix(".log")?;
            let b = date.as_bytes();
            let is_date = b.len() == 10 && b[4] == b'-' && b[7] == b'-' && date.chars().filter(char::is_ascii_digit).count() == 8;
            (is_date && date >= min_date).then(|| (date.to_string(), f.path()))
        })
        .collect();
    files.sort();
    files.into_iter().map(|(_, p)| p).collect()
}

/// Events after `since_ms` for a character, oldest first, de-duplicated by event
/// sequence (seq + wallMs, so a game reload that restarts seq is not mistaken for a
/// replay). None when the character is neither in characters.json nor has logs.
pub(crate) fn character_events(dir: &Path, name: &str, since_ms: u64) -> Option<Vec<Value>> {
    let logs = dir.join("logs");
    // Lines are written as they arrive; allow a day of slack for the date filter.
    let min_date = crate::utc_date((since_ms / 1000).saturating_sub(86_400));
    let files = log_files(&logs, name, &min_date);
    if files.is_empty() && log_files(&logs, name, "").is_empty() && find_character(dir, name).is_none() {
        return None;
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for f in files {
        if let Ok(text) = std::fs::read_to_string(f) {
            parse_events(&text, since_ms, &mut seen, &mut out);
        }
    }
    out.sort_by_key(|e| (e["wallMs"].as_u64().unwrap_or(0), e["seq"].as_u64().unwrap_or(0)));
    Some(out)
}

/// Parse mirrored log lines (`{ts}\t{name}\t{json array}`), keeping unseen events with
/// wallMs > since_ms.
pub(crate) fn parse_events(text: &str, since_ms: u64, seen: &mut HashSet<(u64, u64)>, out: &mut Vec<Value>) {
    for line in text.lines() {
        let mut cols = line.splitn(3, '\t');
        let (Some(ts), Some(_), Some(raw)) = (cols.next(), cols.next(), cols.next()) else { continue };
        // A line holds events seen up to its receive time; skip lines clearly older than the cut.
        if ts.parse::<u64>().is_ok_and(|ts| ts.saturating_mul(1000).saturating_add(60_000) < since_ms) {
            continue;
        }
        let Ok(Value::Array(events)) = serde_json::from_str::<Value>(raw) else { continue };
        for e in events {
            let (Some(seq), Some(wall)) = (e["seq"].as_u64(), e["wallMs"].as_u64()) else { continue };
            if wall > since_ms && seen.insert((seq, wall)) {
                out.push(e);
            }
        }
    }
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MonsterHits {
    monster_id: u64,
    hits: u64,
    total: u64,
    avg: u64,
    max: u64,
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MonsterSkill {
    monster_id: u64,
    skill: String,
    count: u64,
    damage: u64,
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Zeny {
    #[serde(rename = "in")]
    gained: u64,
    #[serde(rename = "out")]
    spent: u64,
    net: i64,
    auto_sell: u64,
    shop_sell: u64,
    shop_buy: u64,
    auto_buy: u64,
    trade_in: u64,
    trade_out: u64,
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Interrupts {
    total: u64,
    by_reason: BTreeMap<String, u64>,
    by_skill: BTreeMap<String, u64>,
}

/// Per-character battle summary (port of the scratch logstat.mjs, plus deaths,
/// zeny flow and interrupted casts).
#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Summary {
    events: u64,
    first_ms: Option<u64>,
    last_ms: Option<u64>,
    /// Minutes between first and last event (at least 1), the base for the per-hour rates.
    span_minutes: f64,
    base_exp: u64,
    job_exp: u64,
    base_exp_per_hour: u64,
    job_exp_per_hour: u64,
    kills: u64,
    damage_dealt: u64,
    damage_taken: u64,
    hits_taken: u64,
    misses: u64,
    hit_by: Vec<MonsterHits>,
    monster_skills: Vec<MonsterSkill>,
    deaths: Vec<Value>,
    potions: u64,
    items_used: BTreeMap<String, u64>,
    no_potion: u64,
    zeny: Zeny,
    interrupts: Interrupts,
    sits: u64,
    heals_and_buffs: BTreeMap<String, u64>,
    warnings: BTreeMap<String, u64>,
    stops: BTreeMap<String, u64>,
    lowest_hp: Option<u64>,
    max_hp: Option<u64>,
    other: BTreeMap<String, u64>,
}

const IGNORED: &[&str] = &[
    "searching", "found", "drop", "pickup", "stand", "buffStart", "buffEnd", "skillCast", "targetSwitch",
    "targetSkip", "luring", "respawn",
];

pub(crate) fn summarize(events: &[Value]) -> Summary {
    let mut s = Summary::default();
    let mut hit_by: BTreeMap<u64, Vec<u64>> = BTreeMap::new();
    let mut mob: BTreeMap<(u64, String), (u64, u64)> = BTreeMap::new();
    let n = |v: &Value| v.as_u64().unwrap_or(0);
    let text = |v: &Value| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string());
    let bump = |m: &mut BTreeMap<String, u64>, k: String| *m.entry(k).or_default() += 1;
    for e in events {
        let (b, wall) = (&e["body"], n(&e["wallMs"]));
        s.events += 1;
        s.first_ms = Some(s.first_ms.map_or(wall, |t| t.min(wall)));
        s.last_ms = Some(s.last_ms.map_or(wall, |t| t.max(wall)));
        if let Some(hp) = b["me"][0].as_u64() {
            s.lowest_hp = Some(s.lowest_hp.map_or(hp, |l| l.min(hp)));
        }
        let ty = b["type"].as_str().unwrap_or("");
        match ty {
            "monsterAttack" => {
                if let Some(m) = b["maxHp"].as_u64() {
                    s.max_hp = Some(m);
                }
                let dmg = n(&b["damage"]);
                if b["result"] == "miss" || dmg == 0 {
                    s.misses += 1;
                } else {
                    s.hits_taken += 1;
                    s.damage_taken += dmg;
                    hit_by.entry(n(&b["monsterId"])).or_default().push(dmg);
                }
            }
            "mobSkill" => {
                let dmg = n(&b["damage"]);
                let m = mob.entry((n(&b["monsterId"]), text(&b["skill"]))).or_default();
                m.0 += 1;
                m.1 += dmg;
                s.damage_taken += dmg;
            }
            "playerAttack" | "skillHit" => s.damage_dealt += n(&b["damage"]),
            "kill" => s.kills += 1,
            "exp" => {
                s.base_exp += n(&b["base"]);
                s.job_exp += n(&b["job"]);
            }
            "death" => {
                let mut d = b.clone();
                if let Value::Object(m) = &mut d {
                    m.remove("type");
                    m.insert("wallMs".into(), json!(wall));
                }
                s.deaths.push(d);
            }
            "sit" => s.sits += 1,
            "useItem" => {
                // Everything but escape items (fly/butterfly wings) is a potion use.
                if b["reason"]["k"] != "escape" {
                    s.potions += 1;
                }
                bump(&mut s.items_used, text(&b["itemId"]));
            }
            "noPotion" => s.no_potion += 1,
            "autoSell" => s.zeny.auto_sell += n(&b["zeny"]),
            "shopSell" => s.zeny.shop_sell += n(&b["zeny"]),
            "shopBuy" => s.zeny.shop_buy += n(&b["zeny"]),
            "autoBuy" => s.zeny.auto_buy += n(&b["zeny"]),
            "trade" => {
                s.zeny.trade_in += n(&b["got"]["zeny"]);
                s.zeny.trade_out += n(&b["gave"]["zeny"]);
            }
            "skillInterrupt" => {
                s.interrupts.total += 1;
                bump(&mut s.interrupts.by_reason, text(&b["reason"]));
                bump(&mut s.interrupts.by_skill, text(&b["skill"]));
            }
            "skillHeal" | "support" => {
                let from = b["from"].as_str().map_or(String::new(), |f| format!(" from {f}"));
                bump(&mut s.heals_and_buffs, format!("{}{from}", text(&b["skill"])));
            }
            "system" if b["level"].as_str().is_none_or(|l| l == "warn") => bump(&mut s.warnings, text(&b["message"])),
            "system" => {}
            "stop" => bump(&mut s.stops, text(&b["reason"])),
            t if IGNORED.contains(&t) => {}
            t => bump(&mut s.other, t.to_string()),
        }
    }
    s.hit_by = hit_by
        .into_iter()
        .map(|(monster_id, v)| {
            let total: u64 = v.iter().sum();
            let hits = v.len() as u64;
            MonsterHits { monster_id, hits, total, avg: (total as f64 / hits as f64).round() as u64, max: v.into_iter().max().unwrap_or(0) }
        })
        .collect();
    s.monster_skills = mob
        .into_iter()
        .map(|((monster_id, skill), (count, damage))| MonsterSkill { monster_id, skill, count, damage })
        .collect();
    let z = &mut s.zeny;
    z.gained = z.auto_sell + z.shop_sell + z.trade_in;
    z.spent = z.shop_buy + z.auto_buy + z.trade_out;
    z.net = z.gained as i64 - z.spent as i64;
    let span_ms = s.last_ms.unwrap_or(0).saturating_sub(s.first_ms.unwrap_or(0));
    let span_min = (span_ms as f64 / 60_000.0).max(1.0);
    s.span_minutes = (span_min * 10.0).round() / 10.0;
    let per_hour = |x: u64| (x as f64 * 60.0 / span_min).round() as u64;
    s.base_exp_per_hour = per_hour(s.base_exp);
    s.job_exp_per_hour = per_hour(s.job_exp);
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const BEARER: &str = "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    // T0 = 2026-11-02T00:00:00Z
    const T0: u64 = 1_793_577_600_000;

    /// Fixed sample log: 10 minutes of play, with the second line a replayed batch
    /// (same seqs) as the game's stream does on reconnect.
    fn sample_log() -> String {
        let ev = |seq: u64, min: u64, body: Value| json!({ "seq": seq, "wallMs": T0 + min * 60_000, "simTime": 0, "body": body });
        let a = json!([
            ev(1, 0, json!({"type":"searching"})),
            ev(2, 0, json!({"type":"monsterAttack","monsterId":1002,"damage":7,"result":"hit","maxHp":102,"me":[86,23]})),
            ev(3, 1, json!({"type":"monsterAttack","monsterId":1002,"damage":13,"result":"hit","maxHp":102,"me":[73,23]})),
            ev(4, 1, json!({"type":"monsterAttack","monsterId":1002,"damage":0,"result":"miss","maxHp":102,"me":[73,23]})),
            ev(5, 2, json!({"type":"playerAttack","monsterId":1002,"damage":19,"me":[73,23]})),
            ev(6, 2, json!({"type":"kill","monsterId":1002})),
            ev(7, 2, json!({"type":"exp","base":30,"job":20})),
            ev(8, 3, json!({"type":"mobSkill","monsterId":1002,"skill":"NPC_WATERATTACK","damage":8,"result":"hit"})),
            ev(9, 3, json!({"type":"useItem","itemId":501,"auto":true,"hp":50})),
        ]);
        let b = json!([
            ev(9, 3, json!({"type":"useItem","itemId":501,"auto":true,"hp":50})),
            ev(10, 4, json!({"type":"skillInterrupt","skill":"MG_FIREBOLT","reason":"damage"})),
            ev(11, 4, json!({"type":"skillInterrupt","skill":"MG_FIREBOLT","reason":"damage"})),
            ev(12, 5, json!({"type":"sit","hpPercent":35})),
            ev(13, 5, json!({"type":"system","level":"warn","message":"no potions"})),
            ev(14, 6, json!({"type":"death","mapId":"prt_fild08","damage":11,"expLost":0,"monsterId":1113})),
            ev(15, 6, json!({"type":"stop","reason":"DEATH"})),
            ev(16, 7, json!({"type":"autoSell","itemId":507,"qty":9,"zeny":81})),
            ev(17, 7, json!({"type":"shopBuy","itemId":501,"qty":10,"zeny":500})),
            ev(18, 8, json!({"type":"trade","with":"牙暉","got":{"zeny":0,"items":[]},"gave":{"zeny":1000,"items":[]}})),
            ev(19, 9, json!({"type":"support","skill":"AL_BLESSING","to":"嘈嘈嘈"})),
            ev(20, 10, json!({"type":"exp","base":30,"job":10})),
            ev(21, 10, json!({"type":"weight","percent":50})),
            ev(22, 10, json!({"type":"useItem","itemId":602,"hp":0,"reason":{"k":"escape","cause":"skillUnavailable"}})),
            ev(23, 10, json!({"type":"system","level":"info","message":"settings saved"})),
        ]);
        let ts = |min: u64| (T0 + min * 60_000) / 1000;
        format!("{}\t嘈嘈嘈\t{a}\n{}\t嘈嘈嘈\t{b}\nnot a log line\n", ts(3), ts(10))
    }

    fn sample_events() -> Vec<Value> {
        let mut out = Vec::new();
        parse_events(&sample_log(), 0, &mut HashSet::new(), &mut out);
        out
    }

    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ro-idle-api-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("logs")).unwrap();
        std::fs::write(
            d.join("characters.json"),
            r#"{"7":{"name":"嘈嘈嘈","base":20,"zeny":5},"3":{"name":"牙暉","base":32}}"#,
        )
        .unwrap();
        std::fs::write(d.join("logs/嘈嘈嘈-2026-11-02.log"), sample_log()).unwrap();
        std::fs::write(d.join("logs/嘈嘈嘈2-2026-11-02.log"), sample_log()).unwrap();
        d
    }

    #[test]
    fn dedupes_replayed_events_by_seq() {
        let ev = sample_events();
        assert_eq!(ev.len(), 23);
        let mut out = Vec::new();
        parse_events(&sample_log(), T0 + 5 * 60_000, &mut HashSet::new(), &mut out);
        assert_eq!(out.iter().map(|e| e["seq"].as_u64().unwrap()).collect::<Vec<_>>(), (14..=23).collect::<Vec<_>>());
    }

    #[test]
    fn summary_of_fixed_sample_log() {
        let s = summarize(&sample_events());
        assert_eq!(s.events, 23);
        assert_eq!(s.span_minutes, 10.0);
        assert_eq!((s.base_exp, s.job_exp), (60, 30));
        assert_eq!((s.base_exp_per_hour, s.job_exp_per_hour), (360, 180));
        assert_eq!((s.kills, s.damage_dealt), (1, 19));
        assert_eq!((s.hits_taken, s.misses, s.damage_taken), (2, 1, 28));
        assert_eq!(s.hit_by, vec![MonsterHits { monster_id: 1002, hits: 2, total: 20, avg: 10, max: 13 }]);
        assert_eq!(
            s.monster_skills,
            vec![MonsterSkill { monster_id: 1002, skill: "NPC_WATERATTACK".into(), count: 1, damage: 8 }]
        );
        assert_eq!(s.deaths, vec![json!({"mapId":"prt_fild08","damage":11,"expLost":0,"monsterId":1113,"wallMs":T0 + 360_000})]);
        assert_eq!((s.potions, s.items_used.get("501").copied(), s.items_used.get("602").copied()), (1, Some(1), Some(1)));
        assert_eq!(
            s.zeny,
            Zeny { gained: 81, spent: 1500, net: -1419, auto_sell: 81, shop_sell: 0, shop_buy: 500, auto_buy: 0, trade_in: 0, trade_out: 1000 }
        );
        assert_eq!(s.interrupts.total, 2);
        assert_eq!(s.interrupts.by_reason.get("damage"), Some(&2));
        assert_eq!(s.interrupts.by_skill.get("MG_FIREBOLT"), Some(&2));
        assert_eq!(s.sits, 1);
        assert_eq!(s.warnings.len(), 1);
        assert_eq!(s.warnings.get("no potions"), Some(&1));
        assert_eq!(s.stops.get("DEATH"), Some(&1));
        assert_eq!(s.heals_and_buffs.get("AL_BLESSING"), Some(&1));
        assert_eq!((s.lowest_hp, s.max_hp), (Some(73), Some(102)));
        assert_eq!(s.other.get("weight"), Some(&1));
        assert!(!s.other.contains_key("searching"));
    }

    #[test]
    fn empty_summary_is_zeroes() {
        let s = summarize(&[]);
        assert_eq!((s.events, s.base_exp_per_hour, s.first_ms), (0, 0, None));
    }

    #[test]
    fn every_request_without_token_is_401() {
        let d = tmp_dir("auth");
        for auth in [None, Some("Bearer nope"), Some(TOKEN), Some("Basic abc")] {
            for path in ["/characters", "/characters/%E5%98%88%E5%98%88%E5%98%88/summary", "/nope"] {
                assert_eq!(respond("GET", path, auth, TOKEN, &d, T0).0, 401, "{auth:?} {path}");
            }
        }
        assert_eq!(respond("GET", "/characters", Some(BEARER), TOKEN, &d, T0).0, 200);
    }

    #[test]
    fn read_only_and_unknown_routes() {
        let d = tmp_dir("routes");
        for m in ["POST", "PUT", "DELETE", "PATCH"] {
            assert_eq!(respond(m, "/characters", Some(BEARER), TOKEN, &d, T0).0, 405);
        }
        assert_eq!(respond("GET", "/", Some(BEARER), TOKEN, &d, T0).0, 404);
        assert_eq!(respond("GET", "/characters/nobody", Some(BEARER), TOKEN, &d, T0).0, 404);
        assert_eq!(respond("GET", "/characters/nobody/log", Some(BEARER), TOKEN, &d, T0).0, 404);
        assert_eq!(respond("GET", "/characters/%ZZ", Some(BEARER), TOKEN, &d, T0).0, 400);
        let before = std::fs::read_to_string(d.join("characters.json")).unwrap();
        respond("GET", "/characters/%E5%98%88%E5%98%88%E5%98%88/summary", Some(BEARER), TOKEN, &d, T0);
        assert_eq!(std::fs::read_to_string(d.join("characters.json")).unwrap(), before);
    }

    #[test]
    fn lists_and_fetches_characters() {
        let d = tmp_dir("chars");
        let (st, list) = respond("GET", "/characters", Some(BEARER), TOKEN, &d, T0);
        assert_eq!(st, 200);
        assert_eq!(
            list,
            json!([
                {"name":"牙暉","base":32,"profile":3,"goal":null,"nickname":null},
                {"name":"嘈嘈嘈","base":20,"zeny":5,"profile":7,"goal":null,"nickname":null}
            ])
        );
        let (st, one) = respond("GET", "/characters/%E5%98%88%E5%98%88%E5%98%88", Some(BEARER), TOKEN, &d, T0);
        assert_eq!((st, one["profile"].as_u64(), one["zeny"].as_u64()), (200, Some(7), Some(5)));
    }

    #[test]
    fn merges_goal_and_nickname_into_snapshots() {
        let d = tmp_dir("goals");
        std::fs::write(d.join("goals.json"), r#"{"牙暉":"超魔導師","嘈嘈嘈":"  ","ghost":"騎士"}"#).unwrap();
        std::fs::write(d.join("nicknames.json"), r#"{"嘈嘈嘈":"小嘈"}"#).unwrap();
        let (_, list) = respond("GET", "/characters", Some(BEARER), TOKEN, &d, T0);
        assert_eq!(list[0], json!({"name":"牙暉","base":32,"profile":3,"goal":"超魔導師","nickname":null}));
        // Blank goal is unset; entries for characters without a snapshot are ignored.
        assert_eq!((&list[1]["goal"], &list[1]["nickname"]), (&Value::Null, &json!("小嘈")));
        assert_eq!(list.as_array().unwrap().len(), 2);
        let (_, one) = respond("GET", "/characters/%E7%89%99%E6%9A%89", Some(BEARER), TOKEN, &d, T0);
        assert_eq!(one["goal"], "超魔導師");
        // Unreadable files fall back to null rather than failing the request.
        std::fs::write(d.join("goals.json"), "not json").unwrap();
        assert_eq!(respond("GET", "/characters/%E7%89%99%E6%9A%89", Some(BEARER), TOKEN, &d, T0).1["goal"], Value::Null);
    }

    #[test]
    fn log_endpoint_filters_dedupes_and_limits() {
        let d = tmp_dir("log");
        let since = (T0 + 5 * 60_000) / 1000;
        let (st, body) = respond("GET", &format!("/characters/%E5%98%88%E5%98%88%E5%98%88/log?since={since}"), Some(BEARER), TOKEN, &d, T0);
        assert_eq!(st, 200);
        // Only 嘈嘈嘈's own file is read (not 嘈嘈嘈2's), so no doubles.
        assert_eq!(body["events"].as_array().unwrap().len(), 10);
        assert_eq!(body["truncated"], false);
        let (_, body) = respond("GET", "/characters/%E5%98%88%E5%98%88%E5%98%88/log?limit=5", Some(BEARER), TOKEN, &d, T0);
        assert_eq!(body["events"].as_array().unwrap().len(), 5);
        assert_eq!(body["events"][0]["seq"], 1);
        assert_eq!(body["truncated"], true);
        assert_eq!(respond("GET", "/characters/%E5%98%88%E5%98%88%E5%98%88/log?since=x", Some(BEARER), TOKEN, &d, T0).0, 400);
    }

    #[test]
    fn summary_endpoint_uses_window() {
        let d = tmp_dir("summary");
        let now = T0 + 10 * 60_000;
        let (st, all) = respond("GET", "/characters/%E5%98%88%E5%98%88%E5%98%88/summary?minutes=60", Some(BEARER), TOKEN, &d, now);
        assert_eq!(st, 200);
        assert_eq!((all["events"].as_u64(), all["baseExp"].as_u64(), all["minutes"].as_u64()), (Some(23), Some(60), Some(60)));
        assert_eq!(all["zeny"]["out"], 1500);
        // Last 4 minutes: events at minutes 6..=10 only.
        let (_, recent) = respond("GET", "/characters/%E5%98%88%E5%98%88%E5%98%88/summary?minutes=4", Some(BEARER), TOKEN, &d, now);
        assert_eq!((recent["events"].as_u64(), recent["baseExp"].as_u64(), recent["deaths"].as_array().map(Vec::len)), (Some(10), Some(30), Some(1)));
    }

    #[test]
    fn log_stem_matches_mirror_rule() {
        assert_eq!(log_stem("a/b\\c:d\te"), "a_b_c_d_e");
        assert_eq!(log_stem("嘈嘈嘈"), "嘈嘈嘈");
    }

    #[test]
    fn decodes_percent_encoded_names() {
        assert_eq!(percent_decode("%E5%98%88%E5%98%88%E5%98%882").as_deref(), Some("嘈嘈嘈2"));
        assert_eq!(percent_decode("abc").as_deref(), Some("abc"));
        assert_eq!(percent_decode("%E5"), None);
        assert_eq!(percent_decode("%4"), None);
    }

    #[test]
    fn token_is_random_hex() {
        let (a, b) = (new_token(), new_token());
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn binds_loopback_and_serves_http() {
        let d = tmp_dir("http");
        let listener = bind(0).unwrap();
        let addr = listener.local_addr().unwrap();
        assert!(addr.ip().is_loopback());
        let dir = d.clone();
        let server = std::thread::spawn(move || {
            for _ in 0..2 {
                let (s, _) = listener.accept().unwrap();
                handle_conn(s, &dir, TOKEN).unwrap();
            }
        });
        let get = |auth: &str| {
            let mut c = TcpStream::connect(addr).unwrap();
            write!(c, "GET /characters HTTP/1.1\r\nHost: localhost\r\n{auth}\r\n").unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };
        assert!(get("").starts_with("HTTP/1.1 401"));
        let ok = get(&format!("authorization: {BEARER}\r\n"));
        assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
        assert!(ok.ends_with(r#""profile":7,"zeny":5}]"#), "{ok}");
        server.join().unwrap();
    }

    #[test]
    fn toggle_routes_and_auths() {
        assert!(toggle("/characters", Some(BEARER), TOKEN).is_none());
        assert_eq!(toggle("/online", None, TOKEN).unwrap().0, 401);
        assert_eq!(toggle("/offline?profile=x", Some(BEARER), TOKEN).unwrap().0, 400);
        let _ = ONLINE_HOOK.set(Box::new(|p, _| p != Some(9)));
        assert_eq!(toggle("/online", Some(BEARER), TOKEN).unwrap().0, 200);
        assert_eq!(toggle("/offline?profile=9", Some(BEARER), TOKEN).unwrap().0, 404);
    }

}
