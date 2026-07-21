//! Durable, path-confined storage primitives shared by Aegos control-plane services.
//!
//! Product domains own what is persisted. This module owns only the filesystem
//! safety contract: confined paths, atomic replacement, and deterministic digests.

use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub(crate) fn sha256_text(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

pub(crate) fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|err| err.to_string())
}

pub(crate) fn ensure_path_within(path: &Path, root: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", path.display()))?;
    ensure_dir(root)?;
    ensure_dir(parent)?;
    let root_abs = root.canonicalize().map_err(|err| {
        format!(
            "path confinement root unavailable {}: {err}",
            root.display()
        )
    })?;
    let parent_abs = parent.canonicalize().map_err(|err| {
        format!(
            "path confinement parent unavailable {}: {err}",
            parent.display()
        )
    })?;
    if parent_abs.starts_with(&root_abs) {
        Ok(())
    } else {
        Err(format!(
            "refusing to write outside managed root: {}",
            path.display()
        ))
    }
}

pub(crate) fn atomic_write_text_confined(
    path: &Path,
    root: &Path,
    content: &str,
) -> Result<(), String> {
    ensure_path_within(path, root)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("aegos-file");
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temp_path = parent.join(format!(
        ".{file_name}.{}-{stamp}-{sequence}.tmp",
        std::process::id()
    ));
    {
        let mut file = fs::File::create(&temp_path)
            .map_err(|err| format!("atomic temp create failed {}: {err}", temp_path.display()))?;
        file.write_all(content.as_bytes())
            .map_err(|err| format!("atomic temp write failed {}: {err}", temp_path.display()))?;
        file.sync_all()
            .map_err(|err| format!("atomic temp sync failed {}: {err}", temp_path.display()))?;
    }
    atomic_replace_file(&temp_path, path).map_err(|err| {
        let _ = fs::remove_file(&temp_path);
        format!("atomic replace failed {}: {err}", path.display())
    })
}

pub(crate) fn remove_file_confined(path: &Path, root: &Path) -> Result<(), String> {
    ensure_path_within(path, root)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("remove file failed {}: {err}", path.display())),
    }
}

#[cfg(windows)]
fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let source = OsStr::new(source)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = OsStr::new(destination)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "aegos-storage-{label}-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn confined_atomic_write_replaces_existing_content() {
        let root = test_root("replace");
        let path = root.join("nested").join("state.json");
        atomic_write_text_confined(&path, &root, "first").expect("first write");
        atomic_write_text_confined(&path, &root, "second").expect("replacement write");
        assert_eq!(fs::read_to_string(&path).expect("content"), "second");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn confined_storage_rejects_parent_escape() {
        let root = test_root("escape");
        ensure_dir(&root).expect("root");
        let escaped = root.join("..").join("outside.json");
        assert!(ensure_path_within(&escaped, &root).is_err());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn text_digest_is_deterministic() {
        assert_eq!(sha256_text("aegos"), sha256_text("aegos"));
        assert_ne!(sha256_text("aegos"), sha256_text("mihomo"));
    }
}
