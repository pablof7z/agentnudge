use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use serde::Serialize;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};

use crate::model::PROTOCOL_VERSION;

const MAX_OUTPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionReceipt {
    version: u8,
    status: String,
    exit_code: Option<i32>,
    signal: Option<i32>,
    stdout: String,
    stderr: String,
    stdout_truncated: bool,
    stderr_truncated: bool,
    duration_ms: u64,
    error: Option<String>,
}

struct BoundedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

pub async fn execute(
    workspace: &Path,
    cwd: &Path,
    duration: Duration,
    command: &[OsString],
) -> Result<ExecutionReceipt> {
    let (_workspace, cwd) = resolve_working_directory(workspace, cwd)?;
    let (program, arguments) = command
        .split_first()
        .ok_or_else(|| anyhow::anyhow!("the exec command needs a program"))?;
    let started = Instant::now();
    let mut process = Command::new(program);
    process
        .args(arguments)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        process.as_std_mut().process_group(0);
    }

    let mut child = match process.spawn() {
        Ok(child) => child,
        Err(error) => {
            return Ok(ExecutionReceipt {
                version: PROTOCOL_VERSION,
                status: "spawn_failed".into(),
                exit_code: None,
                signal: None,
                stdout: String::new(),
                stderr: String::new(),
                stdout_truncated: false,
                stderr_truncated: false,
                duration_ms: elapsed_ms(started.elapsed()),
                error: Some(error.to_string()),
            });
        }
    };

    let stdout = child
        .stdout
        .take()
        .context("could not capture command stdout")?;
    let stderr = child
        .stderr
        .take()
        .context("could not capture command stderr")?;
    let stdout_task = tokio::spawn(read_bounded(stdout, MAX_OUTPUT_BYTES));
    let stderr_task = tokio::spawn(read_bounded(stderr, MAX_OUTPUT_BYTES));
    let process_id = child.id();

    let (status, mut timed_out) = match tokio::time::timeout(duration, child.wait()).await {
        Ok(status) => (status.context("could not wait for the command")?, false),
        Err(_) => {
            terminate_process_tree(&mut child, process_id).await?;
            (
                child
                    .wait()
                    .await
                    .context("could not reap the timed-out command")?,
                true,
            )
        }
    };
    while !timed_out && (!stdout_task.is_finished() || !stderr_task.is_finished()) {
        let remaining = duration.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            terminate_process_tree(&mut child, process_id).await?;
            timed_out = true;
            break;
        }
        tokio::time::sleep(remaining.min(Duration::from_millis(5))).await;
    }
    if timed_out && (!stdout_task.is_finished() || !stderr_task.is_finished()) {
        let drain_deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < drain_deadline
            && (!stdout_task.is_finished() || !stderr_task.is_finished())
        {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        if !stdout_task.is_finished() {
            stdout_task.abort();
        }
        if !stderr_task.is_finished() {
            stderr_task.abort();
        }
    }
    let stdout = collect_output(stdout_task).await?;
    let stderr = collect_output(stderr_task).await?;

    #[cfg(unix)]
    let signal = {
        use std::os::unix::process::ExitStatusExt;
        status.signal()
    };
    #[cfg(not(unix))]
    let signal = None;

    Ok(ExecutionReceipt {
        version: PROTOCOL_VERSION,
        status: if timed_out { "timed_out" } else { "exited" }.into(),
        exit_code: if timed_out { None } else { status.code() },
        signal: if timed_out { None } else { signal },
        stdout: String::from_utf8_lossy(&stdout.bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr.bytes).into_owned(),
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
        duration_ms: elapsed_ms(started.elapsed()),
        error: None,
    })
}

async fn collect_output(
    task: tokio::task::JoinHandle<Result<BoundedOutput>>,
) -> Result<BoundedOutput> {
    match task.await {
        Ok(output) => output,
        Err(error) if error.is_cancelled() => Ok(BoundedOutput {
            bytes: vec![],
            truncated: true,
        }),
        Err(error) => Err(error).context("the command output reader stopped unexpectedly"),
    }
}

fn resolve_working_directory(workspace: &Path, cwd: &Path) -> Result<(PathBuf, PathBuf)> {
    let workspace = std::fs::canonicalize(workspace)
        .with_context(|| format!("could not resolve workspace {}", workspace.display()))?;
    if !workspace.is_dir() {
        bail!("the workspace must be a directory");
    }
    if cwd.is_absolute() {
        bail!("--cwd must be relative to the workspace root");
    }
    let cwd = std::fs::canonicalize(workspace.join(cwd))
        .with_context(|| format!("could not resolve working directory {}", cwd.display()))?;
    if !cwd.is_dir() {
        bail!("the working directory must be a directory");
    }
    if !cwd.starts_with(&workspace) {
        bail!("the working directory must remain beneath the workspace root");
    }
    Ok((workspace, cwd))
}

async fn read_bounded<R: AsyncRead + Unpin>(mut reader: R, limit: usize) -> Result<BoundedOutput> {
    let mut bytes = Vec::with_capacity(limit.min(8192));
    let mut buffer = [0u8; 8192];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        let remaining = limit.saturating_sub(bytes.len());
        let kept = count.min(remaining);
        bytes.extend_from_slice(&buffer[..kept]);
        truncated |= kept < count;
    }
    Ok(BoundedOutput { bytes, truncated })
}

async fn terminate_process_tree(child: &mut Child, process_id: Option<u32>) -> Result<()> {
    #[cfg(unix)]
    if let Some(process_id) = process_id.and_then(|value| i32::try_from(value).ok()) {
        let result = unsafe { libc::kill(-process_id, libc::SIGKILL) };
        if result == -1 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err(error).context("could not terminate the command process group");
            }
        }
        return Ok(());
    }

    child
        .kill()
        .await
        .context("could not terminate the timed-out command")
}

fn elapsed_ms(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn executes_direct_argv_and_captures_nonzero_output() {
        let workspace = tempfile::tempdir().unwrap();
        let receipt = execute(
            workspace.path(),
            Path::new("."),
            Duration::from_secs(2),
            &[
                "/bin/sh".into(),
                "-c".into(),
                "printf stdout; printf stderr >&2; exit 7".into(),
            ],
        )
        .await
        .unwrap();
        assert_eq!(receipt.status, "exited");
        assert_eq!(receipt.exit_code, Some(7));
        assert_eq!(receipt.stdout, "stdout");
        assert_eq!(receipt.stderr, "stderr");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn does_not_interpolate_shell_syntax() {
        let workspace = tempfile::tempdir().unwrap();
        let marker = workspace.path().join("should-not-exist");
        let argument = format!("$(touch {})", marker.display());
        let receipt = execute(
            workspace.path(),
            Path::new("."),
            Duration::from_secs(2),
            &[
                "/usr/bin/printf".into(),
                "%s".into(),
                argument.clone().into(),
            ],
        )
        .await
        .unwrap();
        assert_eq!(receipt.stdout, argument);
        assert!(!marker.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn times_out_a_process_group() {
        let workspace = tempfile::tempdir().unwrap();
        let receipt = execute(
            workspace.path(),
            Path::new("."),
            Duration::from_millis(50),
            &["/bin/sh".into(), "-c".into(), "sleep 30 & wait".into()],
        )
        .await
        .unwrap();
        assert_eq!(receipt.status, "timed_out");
        assert!(receipt.duration_ms < 2_000);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn duration_also_bounds_output_pipes_inherited_by_descendants() {
        let workspace = tempfile::tempdir().unwrap();
        let receipt = execute(
            workspace.path(),
            Path::new("."),
            Duration::from_millis(50),
            &["/bin/sh".into(), "-c".into(), "sleep 30 &".into()],
        )
        .await
        .unwrap();
        assert_eq!(receipt.status, "timed_out");
        assert!(receipt.duration_ms < 2_000);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_working_directory_outside_the_workspace() {
        use std::os::unix::fs::symlink;

        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        symlink(outside.path(), workspace.path().join("escape")).unwrap();
        let error = resolve_working_directory(workspace.path(), Path::new("escape"))
            .unwrap_err()
            .to_string();
        assert!(error.contains("beneath the workspace"));
    }

    #[tokio::test]
    async fn returns_a_structured_spawn_failure() {
        let workspace = tempfile::tempdir().unwrap();
        let receipt = execute(
            workspace.path(),
            Path::new("."),
            Duration::from_secs(1),
            &["definitely-not-an-agentnudge-program".into()],
        )
        .await
        .unwrap();
        assert_eq!(receipt.status, "spawn_failed");
        assert!(receipt.error.is_some());
    }

    #[tokio::test]
    async fn drains_and_marks_output_beyond_the_capture_limit() {
        use tokio::io::AsyncWriteExt;

        let (mut writer, reader) = tokio::io::duplex(32);
        let write = tokio::spawn(async move {
            writer.write_all(b"abcdefgh").await.unwrap();
        });
        let output = read_bounded(reader, 4).await.unwrap();
        write.await.unwrap();
        assert_eq!(output.bytes, b"abcd");
        assert!(output.truncated);
    }
}
