//! AI provider settings (base URL, model, API key) and the connection test.
//!
//! The provider is an Anthropic Messages API endpoint, by default the user's
//! local CLIProxyAPI. Base URL and model live in `ai.json` in the app config
//! dir; the API key lives only in the macOS Keychain. Commands here are for
//! the local panel window only: game windows load a remote page and must never
//! reach the key.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, WebviewWindow};

pub const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8317";
pub const DEFAULT_MODEL: &str = "claude-opus-5-5";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const KEYCHAIN_SERVICE: &str = "com.mikewong.ro-idle-tray.ai";
const KEYCHAIN_ACCOUNT: &str = "api-key";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct AiConfig {
    pub base_url: String,
    pub model: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self { base_url: DEFAULT_BASE_URL.into(), model: DEFAULT_MODEL.into() }
    }
}

/// What the panel sees. Never carries the key itself.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
}

/// Token counts from a reply. Cache fields are None when the proxy drops them.
#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TestReport {
    pub ok: bool,
    /// Model name the proxy says answered.
    pub model: Option<String>,
    /// "OK" or the proxy's error text.
    pub message: String,
    /// Some(true) when the repeated request read from cache; None when unknown.
    pub caching: Option<bool>,
}

/// Trims, drops trailing slashes and a trailing `/v1`; empty means the default.
pub fn normalize_base_url(s: &str) -> Result<String, String> {
    let mut url = s.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return Ok(DEFAULT_BASE_URL.into());
    }
    if let Some(stripped) = url.strip_suffix("/v1") {
        url = stripped.trim_end_matches('/').to_string();
    }
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .ok_or("Base URL must start with http:// or https://")?;
    if rest.is_empty() || rest.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Base URL is not a valid URL".into());
    }
    Ok(url)
}

/// Empty means the default model.
pub fn normalize_model(s: &str) -> Result<String, String> {
    let m = s.trim();
    if m.is_empty() {
        return Ok(DEFAULT_MODEL.into());
    }
    if m.len() > 100 || m.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Model name is not valid".into());
    }
    Ok(m.into())
}

pub fn messages_url(base: &str) -> String {
    format!("{base}/v1/messages")
}

/// Fixed system text long enough to pass every model's minimum cacheable
/// prefix (up to 4096 tokens), so the second identical request can hit cache.
fn cache_probe_text() -> String {
    let mut s = String::from("You are a connection test for RO Idle Tray. Reply with the single word OK.\n");
    for i in 0..300 {
        s.push_str(&format!("Reference line {i:04}: the quick brown fox jumps over the lazy dog.\n"));
    }
    s
}

/// Minimal Messages request. Sent twice; the identical prefix shows caching.
pub fn test_request_body(model: &str) -> Value {
    json!({
        "model": model,
        "max_tokens": 16,
        "system": [{
            "type": "text",
            "text": cache_probe_text(),
            "cache_control": { "type": "ephemeral" }
        }],
        "messages": [{ "role": "user", "content": "ping" }]
    })
}

/// Ok((model, usage)) for a 2xx Messages reply, Err(text to show) otherwise.
pub fn parse_reply(status: u16, body: &str) -> Result<(String, Usage), String> {
    let v: Option<Value> = serde_json::from_str(body).ok();
    if !(200..300).contains(&status) {
        let detail = v
            .as_ref()
            .and_then(|v| v.pointer("/error/message").or_else(|| v.get("error")).or_else(|| v.get("message")))
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| clip(body.trim(), 300));
        return Err(if detail.is_empty() { format!("HTTP {status}") } else { format!("HTTP {status}: {detail}") });
    }
    let v = v.ok_or("Reply is not JSON")?;
    if let Some(msg) = v.pointer("/error/message").and_then(Value::as_str) {
        return Err(msg.to_string());
    }
    let model = v.get("model").and_then(Value::as_str).ok_or("Reply has no model field")?.to_string();
    let n = |k: &str| v.pointer(&format!("/usage/{k}")).and_then(Value::as_u64);
    Ok((model, Usage {
        input_tokens: n("input_tokens"),
        cache_creation_input_tokens: n("cache_creation_input_tokens"),
        cache_read_input_tokens: n("cache_read_input_tokens"),
    }))
}

/// Caching works when the repeat read tokens from cache. Unknown when the
/// proxy reports no cache fields at all.
pub fn caching_verdict(first: &Usage, second: &Usage) -> Option<bool> {
    let any = [first, second]
        .iter()
        .any(|u| u.cache_creation_input_tokens.is_some() || u.cache_read_input_tokens.is_some());
    if !any {
        return None;
    }
    Some(second.cache_read_input_tokens.unwrap_or(0) > 0 || first.cache_read_input_tokens.unwrap_or(0) > 0)
}

/// Keeps the key out of anything shown, in case a proxy echoes it.
pub fn redact(msg: &str, key: &str) -> String {
    if key.len() < 4 { msg.to_string() } else { msg.replace(key, "••••") }
}

fn clip(s: &str, n: usize) -> String {
    s.chars().filter(|c| !c.is_control() || *c == ' ').take(n).collect()
}

// ---- storage ----

fn config_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("ai.json"))
}

fn load_config(app: &AppHandle) -> AiConfig {
    config_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, cfg: &AiConfig) -> Result<(), String> {
    let p = config_path(app).ok_or("No config directory")?;
    p.parent().map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|_| std::fs::write(&p, serde_json::to_string_pretty(cfg).unwrap_or_default()))
        .map_err(|e| format!("Cannot save settings: {e}"))
}

#[cfg(target_os = "macos")]
mod keychain {
    use security_framework::passwords;
    const NOT_FOUND: i32 = -25300; // errSecItemNotFound

    pub fn get() -> Result<Option<String>, String> {
        match passwords::get_generic_password(super::KEYCHAIN_SERVICE, super::KEYCHAIN_ACCOUNT) {
            Ok(b) => Ok(Some(String::from_utf8_lossy(&b).into_owned())),
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(e) => Err(format!("Keychain read failed ({})", e.code())),
        }
    }

    pub fn set(key: &str) -> Result<(), String> {
        passwords::set_generic_password(super::KEYCHAIN_SERVICE, super::KEYCHAIN_ACCOUNT, key.as_bytes())
            .map_err(|e| format!("Keychain write failed ({})", e.code()))
    }
}

#[cfg(not(target_os = "macos"))]
mod keychain {
    pub fn get() -> Result<Option<String>, String> { Ok(None) }
    pub fn set(_: &str) -> Result<(), String> { Err("Key storage needs the macOS Keychain".into()) }
}

// ---- commands (panel window only) ----

fn panel_only(w: &WebviewWindow) -> Result<(), String> {
    if w.label() == "panel" { Ok(()) } else { Err("Not allowed from this window".into()) }
}

fn view(cfg: AiConfig) -> Result<SettingsView, String> {
    Ok(SettingsView { base_url: cfg.base_url, model: cfg.model, has_key: keychain::get()?.is_some() })
}

#[tauri::command]
pub fn ai_get_settings(window: WebviewWindow, app: AppHandle) -> Result<SettingsView, String> {
    panel_only(&window)?;
    view(load_config(&app))
}

/// `api_key` None or blank keeps the saved key.
#[tauri::command]
pub fn ai_save_settings(
    window: WebviewWindow,
    app: AppHandle,
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<SettingsView, String> {
    panel_only(&window)?;
    let cfg = AiConfig { base_url: normalize_base_url(&base_url)?, model: normalize_model(&model)? };
    if let Some(k) = api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        if k.chars().any(char::is_control) {
            return Err("API key has invalid characters".into());
        }
        keychain::set(k)?;
    }
    save_config(&app, &cfg)?;
    view(cfg)
}

/// Uses the saved settings. Sends the same minimal request twice.
#[tauri::command]
pub async fn ai_test_connection(window: WebviewWindow, app: AppHandle) -> Result<TestReport, String> {
    panel_only(&window)?;
    let cfg = load_config(&app);
    let Some(key) = keychain::get()? else {
        return Ok(TestReport { ok: false, model: None, message: "No API key saved".into(), caching: None });
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let body = test_request_body(&cfg.model).to_string();
    let send = || async {
        let res = client
            .post(messages_url(&cfg.base_url))
            .header("x-api-key", &key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .body(body.clone())
            .send()
            .await
            .map_err(|e| format!("Cannot reach {}: {e}", cfg.base_url))?;
        let status = res.status().as_u16();
        let text = res.text().await.map_err(|e| e.to_string())?;
        parse_reply(status, &text)
    };
    let fail = |m: String| TestReport { ok: false, model: None, message: redact(&m, &key), caching: None };
    let (model, first) = match send().await {
        Ok(r) => r,
        Err(m) => return Ok(fail(m)),
    };
    let caching = match send().await {
        Ok((_, second)) => caching_verdict(&first, &second),
        Err(_) => None,
    };
    Ok(TestReport { ok: true, model: Some(model), message: "OK".into(), caching })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_normalizes() {
        assert_eq!(normalize_base_url("").unwrap(), DEFAULT_BASE_URL);
        assert_eq!(normalize_base_url("  http://127.0.0.1:8317/ ").unwrap(), "http://127.0.0.1:8317");
        assert_eq!(normalize_base_url("https://proxy.local/v1/").unwrap(), "https://proxy.local");
        assert_eq!(normalize_base_url("http://h/api").unwrap(), "http://h/api");
    }

    #[test]
    fn base_url_rejects_bad_input() {
        assert!(normalize_base_url("127.0.0.1:8317").is_err());
        assert!(normalize_base_url("ftp://x").is_err());
        assert!(normalize_base_url("http://").is_err());
        assert!(normalize_base_url("http://a b").is_err());
    }

    #[test]
    fn model_defaults_and_validates() {
        assert_eq!(normalize_model(" ").unwrap(), DEFAULT_MODEL);
        assert_eq!(normalize_model(" claude-sonnet-5-5 ").unwrap(), "claude-sonnet-5-5");
        assert!(normalize_model("a b").is_err());
    }

    #[test]
    fn url_and_body() {
        assert_eq!(messages_url("http://127.0.0.1:8317"), "http://127.0.0.1:8317/v1/messages");
        let b = test_request_body("m1");
        assert_eq!(b["model"], "m1");
        assert_eq!(b["max_tokens"], 16);
        assert_eq!(b["system"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(b["messages"][0]["role"], "user");
        // Same body every time, so the prefix can be cached.
        assert_eq!(b, test_request_body("m1"));
        // Long enough for a 4096-token minimum (~4 chars per token).
        assert!(b["system"][0]["text"].as_str().unwrap().len() > 4096 * 4);
    }

    #[test]
    fn parses_success() {
        let body = r#"{"id":"msg_1","model":"claude-opus-5-5","content":[],
            "usage":{"input_tokens":5,"cache_creation_input_tokens":4300,"cache_read_input_tokens":0}}"#;
        let (model, u) = parse_reply(200, body).unwrap();
        assert_eq!(model, "claude-opus-5-5");
        assert_eq!(u.input_tokens, Some(5));
        assert_eq!(u.cache_creation_input_tokens, Some(4300));
        assert_eq!(u.cache_read_input_tokens, Some(0));
    }

    #[test]
    fn parses_errors() {
        let anth = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        assert_eq!(parse_reply(401, anth).unwrap_err(), "HTTP 401: invalid x-api-key");
        assert_eq!(parse_reply(502, "Bad Gateway\n").unwrap_err(), "HTTP 502: Bad Gateway");
        assert_eq!(parse_reply(500, "").unwrap_err(), "HTTP 500");
        assert_eq!(parse_reply(401, r#"{"message":"Missing API key"}"#).unwrap_err(), "HTTP 401: Missing API key");
        // CLIProxyAPI's own shape.
        assert_eq!(parse_reply(401, r#"{"error":"Missing API key"}"#).unwrap_err(), "HTTP 401: Missing API key");
        assert!(parse_reply(200, "not json").is_err());
        assert!(parse_reply(200, r#"{"error":{"message":"model not found"}}"#).unwrap_err().contains("model not found"));
    }

    #[test]
    fn caching_verdicts() {
        let u = |c, r| Usage { input_tokens: Some(5), cache_creation_input_tokens: c, cache_read_input_tokens: r };
        assert_eq!(caching_verdict(&u(Some(4300), Some(0)), &u(Some(0), Some(4300))), Some(true));
        assert_eq!(caching_verdict(&u(Some(0), Some(0)), &u(Some(0), Some(0))), Some(false));
        assert_eq!(caching_verdict(&u(None, None), &u(None, None)), None);
        // Warm cache from an earlier test also counts.
        assert_eq!(caching_verdict(&u(Some(0), Some(4300)), &u(Some(0), Some(4300))), Some(true));
    }

    #[test]
    fn redacts_key() {
        assert_eq!(redact("bad key sk-123456", "sk-123456"), "bad key ••••");
        assert_eq!(redact("x", ""), "x");
    }

    #[test]
    fn settings_view_has_no_key_field() {
        let v = serde_json::to_value(SettingsView { base_url: "u".into(), model: "m".into(), has_key: true }).unwrap();
        assert_eq!(v, json!({"baseUrl":"u","model":"m","hasKey":true}));
    }
}
