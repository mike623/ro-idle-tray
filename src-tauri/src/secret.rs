//! API keys live in the macOS login Keychain (service `com.mikewong.ro-idle-tray.ai`),
//! never in a file. Each key is read from the Keychain at most once per run and
//! then kept in memory, so an ad-hoc rebuild (new code signature) costs at most
//! one "allow" prompt per key per launch; choose "Always Allow" to stop it until
//! the next rebuild.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.mikewong.ro-idle-tray.ai";
pub const AI: &str = "api-key";
pub const TAVILY: &str = "tavily-key";

/// Keychain reads cached for this run: account -> value (None = nothing saved).
static CACHE: Mutex<Option<HashMap<&'static str, Option<String>>>> = Mutex::new(None);

#[cfg(target_os = "macos")]
fn keychain_get(account: &str) -> Result<Option<String>, String> {
    use security_framework::passwords;
    match passwords::get_generic_password(SERVICE, account) {
        Ok(bytes) => Ok(String::from_utf8(bytes).ok()),
        // errSecItemNotFound
        Err(e) if e.code() == -25300 => Ok(None),
        Err(e) => Err(format!("Cannot read the key from Keychain: {e}")),
    }
}

#[cfg(target_os = "macos")]
fn keychain_set(account: &str, value: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(SERVICE, account, value.as_bytes())
        .map_err(|e| format!("Cannot save the key to Keychain: {e}"))
}

#[cfg(not(target_os = "macos"))]
fn keychain_get(_: &str) -> Result<Option<String>, String> {
    Err("Key storage needs the macOS Keychain".into())
}

#[cfg(not(target_os = "macos"))]
fn keychain_set(_: &str, _: &str) -> Result<(), String> {
    Err("Key storage needs the macOS Keychain".into())
}

pub fn load_named(_app: &AppHandle, account: &'static str) -> Result<Option<String>, String> {
    let mut cache = CACHE.lock().unwrap();
    let cache = cache.get_or_insert_with(HashMap::new);
    if let Some(v) = cache.get(account) {
        return Ok(v.clone());
    }
    let v = keychain_get(account)?;
    cache.insert(account, v.clone());
    Ok(v)
}

pub fn save_named(app: &AppHandle, account: &'static str, value: &str) -> Result<(), String> {
    keychain_set(account, value)?;
    CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(account, Some(value.to_string()));
    // Drop the file-based copies an earlier dev build wrote; the Keychain is the only store now.
    if let Ok(dir) = app.path().app_config_dir() {
        for old in ["ai-key.bin", "tavily-key.bin"] {
            let _ = std::fs::remove_file(dir.join(old));
        }
    }
    Ok(())
}

/// The AI provider key.
pub fn load(app: &AppHandle) -> Result<Option<String>, String> {
    load_named(app, AI)
}

pub fn save(app: &AppHandle, value: &str) -> Result<(), String> {
    save_named(app, AI, value)
}
