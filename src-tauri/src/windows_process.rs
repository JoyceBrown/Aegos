//! Bounded Windows process execution used by platform adapters.

use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::CloseHandle,
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub(crate) const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Owns a private Windows job that terminates only its assigned child when the
/// Aegos process exits unexpectedly. It deliberately has no path-wide cleanup.
pub(crate) struct ManagedChildJob {
    #[cfg(windows)]
    handle: isize,
}

impl ManagedChildJob {
    #[cfg(windows)]
    pub(crate) fn assign(child: &std::process::Child) -> Result<Self, String> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) } as isize;
        if handle == 0 {
            return Err("could not create managed core job object".to_string());
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle as *mut std::ffi::c_void,
                JobObjectExtendedLimitInformation,
                &limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            unsafe { CloseHandle(handle as *mut std::ffi::c_void) };
            return Err("could not configure managed core job object".to_string());
        }
        let assigned = unsafe {
            AssignProcessToJobObject(handle as *mut std::ffi::c_void, child.as_raw_handle())
        };
        if assigned == 0 {
            unsafe { CloseHandle(handle as *mut std::ffi::c_void) };
            return Err("could not assign managed core process to its job object".to_string());
        }
        Ok(Self { handle })
    }

    #[cfg(not(windows))]
    pub(crate) fn assign(_child: &std::process::Child) -> Result<Self, String> {
        Ok(Self {})
    }
}

impl Drop for ManagedChildJob {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            CloseHandle(self.handle as *mut std::ffi::c_void);
        }
    }
}

pub(crate) fn run_powershell(script: &str) -> Result<String, String> {
    run_powershell_with_timeout(script, Duration::from_secs(30))
}

pub(crate) fn run_powershell_with_timeout(
    script: &str,
    timeout: Duration,
) -> Result<String, String> {
    let wrapped_script = format!(
        "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8;\n{script}"
    );
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &wrapped_script,
    ]);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|err| err.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "PowerShell stdout pipe is unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "PowerShell stderr pipe is unavailable".to_string())?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut stream = stdout;
        stream.read_to_end(&mut bytes).map(|_| bytes)
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut stream = stderr;
        stream.read_to_end(&mut bytes).map(|_| bytes)
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|err| err.to_string())? {
            break status;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(format!(
                "PowerShell command timed out after {} ms",
                timeout.as_millis()
            ));
        }
        thread::sleep(Duration::from_millis(20));
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| "PowerShell stdout reader failed".to_string())?
        .map_err(|err| err.to_string())?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "PowerShell stderr reader failed".to_string())?
        .map_err(|err| err.to_string())?;
    if status.success() {
        Ok(String::from_utf8_lossy(&stdout).trim().to_string())
    } else {
        let message = String::from_utf8_lossy(&stderr).trim().to_string();
        Err(if message.is_empty() {
            format!("PowerShell command failed with status {status}")
        } else {
            message
        })
    }
}

fn managed_core_cleanup_script(core_path: &Path, home_dir: &Path) -> String {
    let core_literal = crate::core_runtime::powershell_single_quoted_literal(
        crate::core_runtime::normalize_windows_program_path_text(&core_path.to_string_lossy()),
    );
    let root_literal = crate::core_runtime::powershell_single_quoted_literal(
        crate::core_runtime::normalize_windows_program_path_text(&home_dir.to_string_lossy()),
    );
    format!(
        r#"
$target = {core_literal}
$expectedRoot = {root_literal}
$rootPattern = [regex]::Escape($expectedRoot)
$argumentPattern = '(?i)(?:^|\s)-d\s+(?:"' + $rootPattern + '"|' + $rootPattern + ')(?=\s|$)'
$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {{ $_.ExecutablePath -and $_.CommandLine -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq [IO.Path]::GetFullPath($target)) -and $_.CommandLine -match $argumentPattern }})
foreach ($process in $processes) {{ Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop }}
Start-Sleep -Milliseconds 250
$remaining = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {{ $_.ExecutablePath -and $_.CommandLine -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq [IO.Path]::GetFullPath($target)) -and $_.CommandLine -match $argumentPattern }})
if ($remaining.Count -gt 0) {{ throw 'The exact interrupted Aegos network engine is still running' }}
"stopped=$($processes.Count)"
"#
    )
}

pub(crate) fn stop_managed_core_for_root(
    core_path: &Path,
    home_dir: &Path,
) -> Result<String, String> {
    run_powershell(&managed_core_cleanup_script(core_path, home_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn timeout_terminates_a_stalled_command() {
        let started = Instant::now();
        let error =
            run_powershell_with_timeout("Start-Sleep -Seconds 5", Duration::from_millis(150))
                .expect_err("sleeping PowerShell command should time out");
        assert!(error.contains("timed out after 150 ms"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn managed_core_cleanup_requires_the_exact_runtime_root_argument() {
        let script = managed_core_cleanup_script(
            Path::new("C:/Aegos/Core/mihomo.exe"),
            Path::new("C:/Aegos/runs/owned"),
        );
        assert!(script.contains("Get-CimInstance Win32_Process"));
        assert!(script.contains("$_.CommandLine -match $argumentPattern"));
        assert!(script.contains("$expectedRoot = 'C:\\Aegos\\runs\\owned'"));
        assert!(script.contains("(?i)(?:^|\\s)-d\\s+"));
        assert!(script.contains("Stop-Process -Id $process.ProcessId -Force"));
        assert!(!script.contains("Get-Process -Name"));
        assert!(!script.contains("$_ .Path"));
    }
}
