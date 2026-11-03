//! Encrypted-at-rest storage for the AI API keys.
//!
//! Each key is its own blob in the app config dir (`ai-key.bin`,
//! `tavily-key.bin`) with 0600 permissions. A key is sealed with AES-256-GCM
//! under a wrapping key derived from this machine's id and an app salt, so a
//! copied file is useless on another machine. There is no Keychain involvement:
//! local rebuilds with a changing ad-hoc signature no longer trigger permission
//! prompts.

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SALT: &[u8] = b"com.mikewong.ro-idle-tray/ai-key/v1";
pub const AI_FILE: &str = "ai-key.bin";
pub const TAVILY_FILE: &str = "tavily-key.bin";
const VERSION: u8 = 1;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

fn wrapping_key(machine: &str) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(SALT);
    hash.update(machine.as_bytes());
    hash.finalize().into()
}

fn seal(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Cannot initialize encryption")?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let mut out = Vec::with_capacity(1 + NONCE_LEN + plain.len() + TAG_LEN);
    out.push(VERSION);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&cipher.encrypt(&nonce, plain).map_err(|_| "Cannot encrypt the key")?);
    Ok(out)
}

fn unseal(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 1 + NONCE_LEN + TAG_LEN {
        return Err("Saved key is corrupt".into());
    }
    if data[0] != VERSION {
        return Err("Saved key uses an unsupported format".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Cannot initialize decryption")?;
    let nonce = Nonce::from_slice(&data[1..1 + NONCE_LEN]);
    cipher
        .decrypt(nonce, &data[1 + NONCE_LEN..])
        .map_err(|_| "Saved key cannot be decrypted on this machine; enter it again".into())
}

fn file_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    app.path().app_config_dir().map(|d| d.join(file)).map_err(|e| format!("No config directory: {e}"))
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Cannot create config directory: {e}"))?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| format!("Cannot save the key: {e}"))?;
    file.write_all(bytes).map_err(|e| format!("Cannot save the key: {e}"))?;
    file.sync_all().map_err(|e| format!("Cannot save the key: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// None when nothing is saved or the blob can no longer be opened on this
/// machine (e.g. a copied config); the user simply re-enters the key.
pub fn load_named(app: &AppHandle, file: &str) -> Result<Option<String>, String> {
    let path = file_path(app, file)?;
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Cannot read the saved key: {e}")),
    };
    let machine = machine_uid::get().map_err(|e| format!("Cannot identify this machine: {e}"))?;
    let Ok(plain) = unseal(&wrapping_key(&machine), &bytes) else { return Ok(None) };
    Ok(String::from_utf8(plain).ok())
}

pub fn save_named(app: &AppHandle, file: &str, value: &str) -> Result<(), String> {
    let machine = machine_uid::get().map_err(|e| format!("Cannot identify this machine: {e}"))?;
    let sealed = seal(&wrapping_key(&machine), value.as_bytes())?;
    write_private(&file_path(app, file)?, &sealed)
}

/// The AI provider key.
pub fn load(app: &AppHandle) -> Result<Option<String>, String> {
    load_named(app, AI_FILE)
}

pub fn save(app: &AppHandle, value: &str) -> Result<(), String> {
    save_named(app, AI_FILE, value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_binds_to_the_machine() {
        let key = wrapping_key("machine-a");
        let sealed = seal(&key, b"sk-test-123").unwrap();
        assert_eq!(unseal(&key, &sealed).unwrap(), b"sk-test-123");
        // A different machine cannot open it.
        assert!(unseal(&wrapping_key("machine-b"), &sealed).is_err());
        // Fresh nonce every time.
        assert_ne!(sealed, seal(&key, b"sk-test-123").unwrap());
    }

    #[test]
    fn rejects_tampered_or_unknown_blobs() {
        let key = wrapping_key("machine-a");
        let mut sealed = seal(&key, b"sk-test-123").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        assert!(unseal(&key, &sealed).is_err());
        assert!(unseal(&key, &[VERSION + 1, 0, 0]).is_err());
        assert!(unseal(&key, &[]).is_err());
    }
}
