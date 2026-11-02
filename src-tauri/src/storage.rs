//! Stable filenames for named character data on case-insensitive filesystems.
pub fn character_stem(name: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = format!("{:x}", Sha256::digest(name.as_bytes()));
    let label: String = name
        .chars()
        .take(20)
        .map(|c| {
            if c.is_control() || "/\\:%".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    format!("{label}-{digest}")
}

pub fn write_private_atomic(
    file: &std::path::Path,
    previous: &[u8],
    bytes: &[u8],
) -> Result<(), String> {
    use std::{
        fs,
        io::Write,
        time::{SystemTime, UNIX_EPOCH},
    };
    fs::create_dir_all(file.parent().ok_or("No parent directory")?).map_err(|e| e.to_string())?;
    let temp = file.with_extension(format!(
        "{}-{}.tmp",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options.open(&temp).map_err(|e| e.to_string())?;
    let result = (|| {
        output
            .write_all(bytes)
            .and_then(|_| output.sync_all())
            .map_err(|e| e.to_string())?;
        let current = match fs::read(file) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(e) => return Err(e.to_string()),
        };
        if current != previous {
            return Err("File changed while saving; read it again before retrying".into());
        }
        fs::rename(&temp, file).map_err(|e| e.to_string())
    })();
    let _ = fs::remove_file(temp);
    result
}
