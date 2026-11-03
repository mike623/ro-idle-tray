//! AI provider settings (base URL, model, API key) and the connection test.
//!
//! The provider is an Anthropic Messages API endpoint, by default the user's
//! local CLIProxyAPI. Base URL and model live in `ai.json` in the app config
//! dir; the API key is encrypted at rest by `secret`. Commands here are for
//! the local panel window only: game windows load a remote page and must never
//! reach the key.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, WebviewWindow};

pub const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8317";
pub const DEFAULT_MODEL: &str = "claude-opus-5-5";
const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Serialize, Deserialize)]
#[serde(default)]
pub struct AiConfig {
    pub base_url: String,
    pub model: String,
    /// Wire format: "auto" (Anthropic for claude-* models, else OpenAI), "anthropic" or "openai".
    pub format: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self { base_url: DEFAULT_BASE_URL.into(), model: DEFAULT_MODEL.into(), format: "auto".into() }
    }
}

impl AiConfig {
    /// True when chat should speak Anthropic Messages, false for OpenAI chat completions.
    pub fn uses_anthropic(&self) -> bool {
        match self.format.as_str() {
            "anthropic" => true,
            "openai" => false,
            _ => self.model.to_ascii_lowercase().contains("claude"),
        }
    }
}

fn normalize_format(f: Option<&str>) -> Result<String, String> {
    match f.map(str::trim).unwrap_or("auto") {
        f @ ("auto" | "anthropic" | "openai") => Ok(f.into()),
        _ => Err("Format must be auto, anthropic or openai".into()),
    }
}

/// What the panel sees. Never carries a key itself.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub base_url: String,
    pub model: String,
    pub format: String,
    pub has_key: bool,
    pub has_tavily_key: bool,
}

/// Token counts from a reply. Cache fields are None when the proxy drops them.
#[derive(Serialize, Debug, PartialEq)]
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
    for i in 0..400 {
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

/// Readable text for a non-2xx reply, from either an Anthropic or proxy error shape.
pub fn error_text(status: u16, body: &str) -> String {
    let v: Option<Value> = serde_json::from_str(body).ok();
    let detail = v
        .as_ref()
        .and_then(|v| v.pointer("/error/message").or_else(|| v.get("error")).or_else(|| v.get("message")))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| clip(body.trim(), 300));
    if detail.is_empty() { format!("HTTP {status}") } else { format!("HTTP {status}: {detail}") }
}

/// Model ids from a `GET /v1/models` reply. Accepts Anthropic (`data[].id`)
/// and OpenAI (`data[].id`) shapes, plus `{"models":[...]}` proxies.
pub fn parse_models(body: &str) -> Result<Vec<String>, String> {
    let v: Value = serde_json::from_str(body).map_err(|_| "Model list is not JSON".to_string())?;
    let arr = v
        .get("data")
        .or_else(|| v.get("models"))
        .and_then(Value::as_array)
        .ok_or("Model list has no data")?;
    let mut out: Vec<String> = Vec::new();
    for item in arr {
        let id = item
            .as_str()
            .map(str::to_string)
            .or_else(|| item.get("id").and_then(Value::as_str).map(str::to_string))
            .or_else(|| item.get("name").and_then(Value::as_str).map(str::to_string));
        let Some(id) = id.map(|s| s.trim().to_string()) else { continue };
        if id.is_empty()
            || id.len() > 100
            || id.chars().any(|c| c.is_whitespace() || c.is_control())
            || out.iter().any(|m| m == &id)
        {
            continue;
        }
        out.push(id);
    }
    if out.is_empty() { Err("The provider reported no models".into()) } else { Ok(out) }
}

/// Ok((model, usage)) for a 2xx Messages reply, Err(text to show) otherwise.
pub fn parse_reply(status: u16, body: &str) -> Result<(String, Usage), String> {
    let v: Option<Value> = serde_json::from_str(body).ok();
    if !(200..300).contains(&status) {
        return Err(error_text(status, body));
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

/// reqwest's top-level message hides the cause ("connection refused") in source().
fn error_chain(e: &dyn std::error::Error) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(c) = cur {
        out.push_str(": ");
        out.push_str(&c.to_string());
        cur = c.source();
    }
    out
}

fn clip(s: &str, n: usize) -> String {
    s.chars().filter(|c| !c.is_control() || *c == ' ').take(n).collect()
}

// ---- storage ----

fn config_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("ai.json"))
}

pub(crate) fn load_config(app: &AppHandle) -> AiConfig {
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

/// The saved API key, encrypted at rest in the app config dir.
pub(crate) fn api_key(app: &AppHandle) -> Result<Option<String>, String> {
    crate::secret::load(app)
}

/// The saved Tavily key, used only for web search in chat.
pub(crate) fn tavily_key(app: &AppHandle) -> Result<Option<String>, String> {
    crate::secret::load_named(app, crate::secret::TAVILY_FILE)
}

// ---- commands (panel window only) ----

pub(crate) fn panel_only(w: &WebviewWindow) -> Result<(), String> {
    if w.label() == "panel" { Ok(()) } else { Err("Not allowed from this window".into()) }
}

fn settings_view(app: &AppHandle, cfg: AiConfig) -> Result<SettingsView, String> {
    Ok(SettingsView {
        base_url: cfg.base_url,
        model: cfg.model,
        format: cfg.format,
        has_key: api_key(app)?.is_some(),
        has_tavily_key: tavily_key(app)?.is_some(),
    })
}

#[tauri::command]
pub fn ai_get_settings(window: WebviewWindow, app: AppHandle) -> Result<SettingsView, String> {
    panel_only(&window)?;
    settings_view(&app, load_config(&app))
}

/// `api_key` / `tavily_key` None or blank keeps the saved value.
#[tauri::command]
pub fn ai_save_settings(
    window: WebviewWindow,
    app: AppHandle,
    base_url: String,
    model: String,
    api_key: Option<String>,
    tavily_key: Option<String>,
    format: Option<String>,
) -> Result<SettingsView, String> {
    panel_only(&window)?;
    let cfg = AiConfig {
        base_url: normalize_base_url(&base_url)?,
        model: normalize_model(&model)?,
        format: normalize_format(format.as_deref())?,
    };
    if let Some(k) = api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        if k.chars().any(char::is_control) {
            return Err("API key has invalid characters".into());
        }
        crate::secret::save(&app, k)?;
    }
    if let Some(k) = tavily_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        if k.chars().any(char::is_control) {
            return Err("Tavily key has invalid characters".into());
        }
        crate::secret::save_named(&app, crate::secret::TAVILY_FILE, k)?;
    }
    save_config(&app, &cfg)?;
    settings_view(&app, cfg)
}

/// Valid model ids from the saved provider, for the settings picker. Bearer
/// auth returns the OpenAI-compatible catalog, which covers Claude, Gemini and
/// GPT models, so a single request is enough.
#[tauri::command]
pub async fn ai_list_models(window: WebviewWindow, app: AppHandle) -> Result<Vec<String>, String> {
    panel_only(&window)?;
    let cfg = load_config(&app);
    let key = crate::secret::load(&app)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.get(format!("{}/v1/models?limit=1000", cfg.base_url));
    if let Some(key) = key.as_deref() {
        request = request.header("authorization", format!("Bearer {key}"));
    }
    let res = request
        .send()
        .await
        .map_err(|e| format!("Cannot reach {}: {}", cfg.base_url, error_chain(&e)))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&status) {
        let msg = error_text(status, &text);
        return Err(key.as_deref().map_or(msg.clone(), |k| redact(&msg, k)));
    }
    let mut models = parse_models(&text)?;
    models.sort_unstable();
    Ok(models)
}

/// Uses the saved settings. Sends the same minimal request twice.
#[tauri::command]
pub async fn ai_test_connection(window: WebviewWindow, app: AppHandle) -> Result<TestReport, String> {
    panel_only(&window)?;
    let cfg = load_config(&app);
    let Some(key) = api_key(&app)? else {
        return Ok(TestReport { ok: false, model: None, message: "No API key saved".into(), caching: None });
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        // Never route the key through a system/env HTTP proxy.
        .no_proxy()
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
            .map_err(|e| format!("Cannot reach {}: {}", cfg.base_url, error_chain(&e)))?;
        let status = res.status().as_u16();
        let text = res.text().await.map_err(|e| e.to_string())?;
        parse_reply(status, &text)
    };
    let fail = |m: String| TestReport { ok: false, model: None, message: redact(&m, &key), caching: None };
    let (model, first) = match send().await {
        Ok(r) => r,
        Err(m) => return Ok(fail(m)),
    };
    let (caching, message) = match send().await {
        Ok((_, second)) => (caching_verdict(&first, &second), "OK".to_string()),
        Err(m) => (None, format!("cache check request failed: {}", redact(&m, &key))),
    };
    Ok(TestReport { ok: true, model: Some(model), message, caching })
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
    fn parses_model_lists() {
        // Anthropic.
        let anthropic = r#"{"data":[{"id":"claude-a","display_name":"A"},{"id":"claude-b"}],"has_more":false}"#;
        assert_eq!(parse_models(anthropic).unwrap(), vec!["claude-a", "claude-b"]);
        // OpenAI and plain proxy lists; duplicates, blanks and bad ids are dropped.
        assert_eq!(parse_models(r#"{"models":["gpt-a","gpt-a"," gpt-b ",""]}"#).unwrap(), vec!["gpt-a", "gpt-b"]);
        assert_eq!(parse_models(r#"{"data":[{"name":"gpt-c"}]}"#).unwrap(), vec!["gpt-c"]);
        assert!(parse_models("not json").is_err());
        assert!(parse_models(r#"{"data":[]}"#).is_err());
        assert!(parse_models(r#"{"data":[{"id":"has space"}]}"#).is_err());
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
    fn error_chain_includes_causes() {
        let e = std::io::Error::other("connection refused");
        assert_eq!(error_chain(&e), "connection refused");
    }

    #[test]
    fn redacts_key() {
        assert_eq!(redact("bad key sk-123456", "sk-123456"), "bad key ••••");
        assert_eq!(redact("x", ""), "x");
    }

    #[test]
    fn settings_view_has_no_key_field() {
        let v = serde_json::to_value(SettingsView {
            base_url: "u".into(),
            model: "m".into(),
            format: "auto".into(),
            has_key: true,
            has_tavily_key: false,
        })
        .unwrap();
        assert_eq!(
            v,
            json!({"baseUrl":"u","model":"m","format":"auto","hasKey":true,"hasTavilyKey":false})
        );
    }
}

#[cfg(test)]
mod format_tests {
    use super::*;

    #[test]
    fn format_setting_overrides_model_name_guess() {
        let cfg = |model: &str, format: &str| AiConfig { base_url: String::new(), model: model.into(), format: format.into() };
        assert!(cfg("claude-opus-5-5", "auto").uses_anthropic());
        assert!(!cfg("gpt-5", "auto").uses_anthropic());
        assert!(!cfg("claude-opus-5-5", "openai").uses_anthropic());
        assert!(cfg("gemini-3-pro", "anthropic").uses_anthropic());
        assert_eq!(normalize_format(None).unwrap(), "auto");
        assert!(normalize_format(Some("grpc")).is_err());
        // Old ai.json without the field still loads, as auto.
        let old: AiConfig = serde_json::from_str(r#"{"base_url":"u","model":"m"}"#).unwrap();
        assert_eq!(old.format, "auto");
    }
}
