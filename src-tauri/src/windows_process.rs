//! Bounded Windows process execution used by platform adapters.

use std::{
    io::Read,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub(crate) const CREATE_NO_WINDOW: u32 = 0x08000000;

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
}
