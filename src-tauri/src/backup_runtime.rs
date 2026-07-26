//! Local-only, user-scoped encrypted backups for Aegos product data.
//!
//! Backups intentionally exclude runtime state, diagnostics, system takeover
//! journals, and caches. Windows DPAPI makes each archive usable only by the
//! Windows user who created it; there is no network or synchronization path.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::storage_runtime::{
    atomic_write_bytes_confined, ensure_dir, remove_file_confined, sha256_bytes,
};

const BACKUP_DIR: &str = "local-backups";
const BACKUP_EXTENSION: &str = "aegos-backup";
const BACKUP_MAGIC: &[u8] = b"AEGOSBK1";
const BACKUP_VERSION: u32 = 1;
const MAX_BACKUPS: usize = 12;
const MAX_ENTRIES: usize = 68;
const MAX_ENTRY_BYTES: usize = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 8 * 1024 * 1024;

static BACKUP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupSummary {
    pub(crate) id: String,
    pub(crate) created_at_ms: u128,
    pub(crate) bytes: u64,
    pub(crate) item_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupArchive {
    version: u32,
    created_at_ms: u128,
    entries: Vec<BackupEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupEntry {
    name: String,
    content: String,
    digest: String,
}

pub(crate) fn create_local_backup(
    app_data: &Path,
    profile_dir: &Path,
    settings_path: &Path,
) -> Result<BackupSummary, String> {
    let archive = BackupArchive {
        version: BACKUP_VERSION,
        created_at_ms: now_ms(),
        entries: read_backup_entries(app_data, profile_dir, settings_path)?,
    };
    let archive_json = serde_json::to_vec(&archive)
        .map_err(|err| format!("local backup serialization failed: {err}"))?;
    let protected = protect_for_current_user(&archive_json)?;
    let id = format!(
        "backup-{}-{}",
        archive.created_at_ms,
        BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let directory = backup_dir(app_data);
    ensure_dir(&directory)?;
    let path = directory.join(format!("{id}.{BACKUP_EXTENSION}"));
    let mut encoded = Vec::with_capacity(BACKUP_MAGIC.len() + protected.len());
    encoded.extend_from_slice(BACKUP_MAGIC);
    encoded.extend_from_slice(&protected);
    atomic_write_bytes_confined(&path, &directory, &encoded)?;
    prune_backups(&directory)?;
    Ok(BackupSummary {
        id,
        created_at_ms: archive.created_at_ms,
        bytes: encoded.len() as u64,
        item_count: archive.entries.len(),
    })
}

pub(crate) fn list_local_backups(app_data: &Path) -> Vec<BackupSummary> {
    let directory = backup_dir(app_data);
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut backups = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let id = backup_id_from_path(&path)?;
            let metadata = entry.metadata().ok()?;
            Some(BackupSummary {
                created_at_ms: metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|value| value.as_millis())
                    .unwrap_or_default(),
                id,
                bytes: metadata.len(),
                item_count: 0,
            })
        })
        .collect::<Vec<_>>();
    backups.sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    backups
}

pub(crate) fn restore_local_backup(
    app_data: &Path,
    profile_dir: &Path,
    settings_path: &Path,
    id: &str,
) -> Result<BackupSummary, String> {
    let path = backup_path(app_data, id)?;
    let encoded = fs::read(&path).map_err(|err| format!("local backup read failed: {err}"))?;
    let protected = encoded
        .strip_prefix(BACKUP_MAGIC)
        .ok_or_else(|| "local backup format is not recognized".to_string())?;
    let decoded = unprotect_for_current_user(protected)?;
    let archive: BackupArchive = serde_json::from_slice(&decoded).map_err(|_| {
        "local backup content is invalid or belongs to another Windows user".to_string()
    })?;
    validate_archive(&archive)?;
    restore_entries(app_data, profile_dir, settings_path, &archive.entries)?;
    let metadata =
        fs::metadata(&path).map_err(|err| format!("local backup metadata failed: {err}"))?;
    Ok(BackupSummary {
        id: id.to_string(),
        created_at_ms: archive.created_at_ms,
        bytes: metadata.len(),
        item_count: archive.entries.len(),
    })
}

fn read_backup_entries(
    app_data: &Path,
    profile_dir: &Path,
    settings_path: &Path,
) -> Result<Vec<BackupEntry>, String> {
    let mut files = vec![("settings.json".to_string(), settings_path.to_path_buf())];
    for name in ["aegos-user-rules.json", "routing-user-rules.json"] {
        let path = app_data.join(name);
        if path.exists() {
            files.push((name.to_string(), path));
        }
    }
    for entry in
        fs::read_dir(profile_dir).map_err(|err| format!("profile backup scan failed: {err}"))?
    {
        let entry = entry.map_err(|err| format!("profile backup entry failed: {err}"))?;
        let path = entry.path();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if !entry.file_type().map_err(|err| err.to_string())?.is_file()
            || !matches!(extension.to_ascii_lowercase().as_str(), "yaml" | "yml")
        {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        files.push((format!("profiles/{name}"), path));
    }
    if files.len() > MAX_ENTRIES {
        return Err("local backup has too many profile files".to_string());
    }
    let mut total = 0usize;
    files
        .into_iter()
        .map(|(name, path)| {
            let content =
                fs::read(&path).map_err(|err| format!("local backup read failed: {err}"))?;
            if content.len() > MAX_ENTRY_BYTES {
                return Err("local backup source file exceeds the allowed size".to_string());
            }
            total = total.saturating_add(content.len());
            if total > MAX_TOTAL_BYTES {
                return Err("local backup content exceeds the allowed size".to_string());
            }
            Ok(BackupEntry {
                name,
                digest: sha256_bytes(&content),
                content: STANDARD.encode(content),
            })
        })
        .collect()
}

fn restore_entries(
    app_data: &Path,
    profile_dir: &Path,
    settings_path: &Path,
    entries: &[BackupEntry],
) -> Result<(), String> {
    let desired = entries
        .iter()
        .map(|entry| {
            let path = entry_target_path(app_data, profile_dir, settings_path, &entry.name)?;
            let content = STANDARD
                .decode(&entry.content)
                .map_err(|_| "local backup entry encoding is invalid".to_string())?;
            Ok((path, content))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut previous = Vec::new();
    for (path, _) in &desired {
        previous.push((path.clone(), fs::read(path).ok()));
    }
    for name in ["aegos-user-rules.json", "routing-user-rules.json"] {
        let path = app_data.join(name);
        if !desired.iter().any(|(target, _)| target == &path) {
            previous.push((path.clone(), fs::read(path).ok()));
        }
    }
    for entry in
        fs::read_dir(profile_dir).map_err(|err| format!("profile restore scan failed: {err}"))?
    {
        let entry = entry.map_err(|err| format!("profile restore entry failed: {err}"))?;
        let path = entry.path();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if entry.file_type().map_err(|err| err.to_string())?.is_file()
            && matches!(extension.to_ascii_lowercase().as_str(), "yaml" | "yml")
            && !desired.iter().any(|(target, _)| target == &path)
        {
            previous.push((path, fs::read(entry.path()).ok()));
        }
    }
    let apply = || -> Result<(), String> {
        for (path, content) in &desired {
            atomic_write_bytes_confined(path, app_data, content)?;
        }
        for (path, _) in &previous {
            if (path.starts_with(profile_dir)
                || path == &app_data.join("aegos-user-rules.json")
                || path == &app_data.join("routing-user-rules.json"))
                && !desired.iter().any(|(target, _)| target == path)
            {
                remove_file_confined(path, app_data)?;
            }
        }
        Ok(())
    };
    if let Err(error) = apply() {
        let rollback = previous
            .iter()
            .try_for_each(|(path, content)| match content {
                Some(content) => atomic_write_bytes_confined(path, app_data, content),
                None => remove_file_confined(path, app_data),
            });
        return Err(match rollback {
            Ok(()) => {
                format!("local backup restore failed and previous files were restored: {error}")
            }
            Err(rollback_error) => format!(
                "local backup restore failed: {error}; rollback also failed: {rollback_error}"
            ),
        });
    }
    Ok(())
}

fn validate_archive(archive: &BackupArchive) -> Result<(), String> {
    if archive.version != BACKUP_VERSION
        || archive.entries.is_empty()
        || archive.entries.len() > MAX_ENTRIES
    {
        return Err("local backup version or entry count is invalid".to_string());
    }
    let mut total = 0usize;
    for entry in &archive.entries {
        if !is_allowed_entry_name(&entry.name) {
            return Err("local backup contains an unsupported data entry".to_string());
        }
        let content = STANDARD
            .decode(&entry.content)
            .map_err(|_| "local backup entry encoding is invalid".to_string())?;
        total = total.saturating_add(content.len());
        if content.len() > MAX_ENTRY_BYTES
            || total > MAX_TOTAL_BYTES
            || entry.digest != sha256_bytes(&content)
        {
            return Err("local backup integrity check failed".to_string());
        }
    }
    if !archive
        .entries
        .iter()
        .any(|entry| entry.name == "settings.json")
    {
        return Err("local backup does not contain Aegos settings".to_string());
    }
    Ok(())
}

fn entry_target_path(
    app_data: &Path,
    profile_dir: &Path,
    settings_path: &Path,
    name: &str,
) -> Result<PathBuf, String> {
    match name {
        "settings.json" => Ok(settings_path.to_path_buf()),
        "aegos-user-rules.json" | "routing-user-rules.json" => Ok(app_data.join(name)),
        _ if name.starts_with("profiles/") => Ok(profile_dir.join(&name["profiles/".len()..])),
        _ => Err("local backup contains an unsupported data entry".to_string()),
    }
}

fn is_allowed_entry_name(name: &str) -> bool {
    matches!(
        name,
        "settings.json" | "aegos-user-rules.json" | "routing-user-rules.json"
    ) || (name.starts_with("profiles/") && is_allowed_profile_file_name(&name["profiles/".len()..]))
}

fn is_allowed_profile_file_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\'])
        && name
            .rsplit_once('.')
            .map(|(stem, extension)| {
                !stem.is_empty()
                    && matches!(extension.to_ascii_lowercase().as_str(), "yaml" | "yml")
            })
            .unwrap_or(false)
}

fn backup_dir(app_data: &Path) -> PathBuf {
    app_data.join(BACKUP_DIR)
}

fn backup_path(app_data: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-')
    {
        return Err("local backup identifier is invalid".to_string());
    }
    Ok(backup_dir(app_data).join(format!("{id}.{BACKUP_EXTENSION}")))
}

fn backup_id_from_path(path: &Path) -> Option<String> {
    if path.extension().and_then(|value| value.to_str()) != Some(BACKUP_EXTENSION) {
        return None;
    }
    let id = path.file_stem()?.to_str()?.to_string();
    backup_id_is_valid(&id).then_some(id)
}

fn backup_id_is_valid(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-')
}

fn prune_backups(directory: &Path) -> Result<(), String> {
    let mut backups = fs::read_dir(directory)
        .map_err(|err| format!("local backup prune scan failed: {err}"))?
        .flatten()
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            backup_id_from_path(&entry.path()).map(|_| (modified, entry.path()))
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(|(modified, _)| *modified);
    let remove_count = backups.len().saturating_sub(MAX_BACKUPS);
    for (_, path) in backups.into_iter().take(remove_count) {
        remove_file_confined(&path, directory)?;
    }
    Ok(())
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default()
}

#[cfg(windows)]
#[repr(C)]
struct DataBlob {
    bytes: u32,
    data: *mut u8,
}

#[cfg(windows)]
#[link(name = "Crypt32")]
extern "system" {
    fn CryptProtectData(
        input: *mut DataBlob,
        description: *const u16,
        entropy: *mut DataBlob,
        reserved: *mut core::ffi::c_void,
        prompt: *mut core::ffi::c_void,
        flags: u32,
        output: *mut DataBlob,
    ) -> i32;
    fn CryptUnprotectData(
        input: *mut DataBlob,
        description: *mut *mut u16,
        entropy: *mut DataBlob,
        reserved: *mut core::ffi::c_void,
        prompt: *mut core::ffi::c_void,
        flags: u32,
        output: *mut DataBlob,
    ) -> i32;
}

#[cfg(windows)]
#[link(name = "Kernel32")]
extern "system" {
    fn LocalFree(memory: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
}

#[cfg(windows)]
fn protect_for_current_user(input: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(input, true)
}

#[cfg(windows)]
fn unprotect_for_current_user(input: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(input, false)
}

#[cfg(windows)]
fn dpapi(input: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    if input.is_empty() || input.len() > u32::MAX as usize {
        return Err("local backup encryption input is invalid".to_string());
    }
    let mut source = DataBlob {
        bytes: input.len() as u32,
        data: input.as_ptr() as *mut u8,
    };
    let mut output = DataBlob {
        bytes: 0,
        data: std::ptr::null_mut(),
    };
    let ok = unsafe {
        if protect {
            CryptProtectData(
                &mut source,
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                0x1,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &mut source,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                0x1,
                &mut output,
            )
        }
    };
    if ok == 0 || output.data.is_null() {
        return Err(if protect {
            "Windows user encryption failed"
        } else {
            "local backup cannot be decrypted for this Windows user"
        }
        .to_string());
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.data, output.bytes as usize).to_vec() };
    unsafe {
        LocalFree(output.data.cast());
    }
    Ok(bytes)
}

#[cfg(not(windows))]
fn protect_for_current_user(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("local encrypted backups are only available on Windows".to_string())
}

#[cfg(not(windows))]
fn unprotect_for_current_user(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("local encrypted backups are only available on Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_entry_allowlist_rejects_path_escape_and_runtime_state() {
        assert!(is_allowed_entry_name("settings.json"));
        assert!(is_allowed_entry_name("profiles/default.yaml"));
        assert!(!is_allowed_entry_name("profiles/../settings.json"));
        assert!(!is_allowed_entry_name("system-takeover-active.json"));
    }

    #[test]
    fn backup_archive_requires_settings_and_valid_digest() {
        let content = b"{}";
        let archive = BackupArchive {
            version: BACKUP_VERSION,
            created_at_ms: 1,
            entries: vec![BackupEntry {
                name: "settings.json".to_string(),
                content: STANDARD.encode(content),
                digest: sha256_bytes(content),
            }],
        };
        assert!(validate_archive(&archive).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_round_trip_is_bound_to_current_user() {
        let encrypted = protect_for_current_user(b"aegos-local-backup").expect("encrypt");
        assert_ne!(encrypted, b"aegos-local-backup");
        assert_eq!(
            unprotect_for_current_user(&encrypted).expect("decrypt"),
            b"aegos-local-backup"
        );
    }
}
