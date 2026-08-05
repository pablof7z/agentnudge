use std::path::Path;

#[cfg(target_os = "macos")]
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::time::Duration;

#[cfg(target_os = "macos")]
use anyhow::Context;
use anyhow::{Result, anyhow, bail};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use tokio::process::Command;
#[cfg(target_os = "macos")]
use uuid::Uuid;

#[cfg(target_os = "macos")]
const APPLE_STT_SOURCE: &str = include_str!("../native/macos/agentnudge-stt.swift");
#[cfg(target_os = "macos")]
const HELPER_TIMEOUT: Duration = Duration::from_secs(120);
#[cfg(target_os = "macos")]
const BUILD_TIMEOUT: Duration = Duration::from_secs(60);
pub const MAX_AUDIO_BYTES: usize = 12 * 1024 * 1024;
pub const MAX_LOCALE_CHARS: usize = 64;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Transcription {
    pub text: String,
    pub locale: String,
    pub engine: String,
}

pub fn validate_locale(locale: &str) -> Result<()> {
    if locale.is_empty() || locale.len() > MAX_LOCALE_CHARS {
        bail!("the transcription locale must contain 1 to {MAX_LOCALE_CHARS} characters");
    }
    if !locale
        .bytes()
        .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
    {
        bail!("the transcription locale must be a BCP 47 language tag");
    }
    Ok(())
}

pub fn validate_wav(bytes: &[u8]) -> Result<()> {
    if bytes.len() > MAX_AUDIO_BYTES {
        bail!(
            "the recording exceeds the {} MiB limit",
            MAX_AUDIO_BYTES / (1024 * 1024)
        );
    }
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        bail!("the recording must be a WAV audio file");
    }

    let mut offset = 12usize;
    let mut has_format = false;
    let mut has_audio = false;
    while offset.checked_add(8).is_some_and(|end| end <= bytes.len()) {
        let chunk = &bytes[offset..offset + 4];
        let length = u32::from_le_bytes(
            bytes[offset + 4..offset + 8]
                .try_into()
                .expect("the chunk header has four length bytes"),
        ) as usize;
        let data_start = offset + 8;
        let data_end = data_start
            .checked_add(length)
            .ok_or_else(|| anyhow!("the WAV chunk length is invalid"))?;
        if data_end > bytes.len() {
            bail!("the WAV file contains a truncated chunk");
        }
        if chunk == b"fmt " && length >= 16 {
            has_format = true;
        }
        if chunk == b"data" && length > 0 {
            has_audio = true;
        }
        offset = data_end
            .checked_add(length % 2)
            .ok_or_else(|| anyhow!("the WAV chunk padding is invalid"))?;
    }
    if !has_format || !has_audio {
        bail!("the WAV file must contain format metadata and audio samples");
    }
    Ok(())
}

pub async fn transcribe_wav(
    bytes: &[u8],
    locale: &str,
    runtime_directory: &Path,
) -> Result<Transcription> {
    validate_wav(bytes)?;
    validate_locale(locale)?;

    #[cfg(not(target_os = "macos"))]
    {
        let _ = runtime_directory;
        bail!("local transcription currently requires macOS 26 or later");
    }

    #[cfg(target_os = "macos")]
    {
        let helper = ensure_apple_helper(runtime_directory).await?;
        let audio_path = runtime_directory.join(format!(
            ".agentnudge-stt-audio-{}.wav",
            Uuid::new_v4().simple()
        ));
        write_private_file(&audio_path, bytes)?;

        let result = run_helper(&helper, &audio_path, locale).await;
        let _ = std::fs::remove_file(&audio_path);
        result
    }
}

#[cfg(target_os = "macos")]
async fn ensure_apple_helper(runtime_directory: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(runtime_directory).with_context(|| {
        format!(
            "could not create the AgentNudge runtime directory {}",
            runtime_directory.display()
        )
    })?;
    let fingerprint = source_fingerprint(APPLE_STT_SOURCE.as_bytes());
    let helper = runtime_directory.join(format!("agentnudge-apple-stt-{fingerprint:016x}"));
    if helper.is_file() {
        return Ok(helper);
    }

    let nonce = Uuid::new_v4().simple();
    let source = runtime_directory.join(format!(".agentnudge-apple-stt-{nonce}.swift"));
    let temporary_helper = runtime_directory.join(format!(".agentnudge-apple-stt-{nonce}"));
    write_private_file(&source, APPLE_STT_SOURCE.as_bytes())?;

    let mut command = Command::new("xcrun");
    command
        .args([
            "swiftc",
            "-O",
            "-parse-as-library",
            "-framework",
            "Speech",
            "-framework",
            "AVFoundation",
        ])
        .arg(&source)
        .arg("-o")
        .arg(&temporary_helper)
        .kill_on_drop(true);
    let output = tokio::time::timeout(BUILD_TIMEOUT, command.output())
        .await
        .context("timed out while compiling the Apple speech helper")?
        .context("could not run xcrun to compile the Apple speech helper")?;
    let _ = std::fs::remove_file(&source);
    if !output.status.success() {
        let _ = std::fs::remove_file(&temporary_helper);
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "could not compile the Apple speech helper: {}",
            stderr.trim()
        );
    }

    match std::fs::rename(&temporary_helper, &helper) {
        Ok(()) => {}
        Err(_) if helper.is_file() => {
            let _ = std::fs::remove_file(&temporary_helper);
        }
        Err(error) => {
            let _ = std::fs::remove_file(&temporary_helper);
            return Err(error).with_context(|| {
                format!("could not install Apple speech helper {}", helper.display())
            });
        }
    }
    Ok(helper)
}

#[cfg(target_os = "macos")]
async fn run_helper(helper: &Path, audio: &Path, locale: &str) -> Result<Transcription> {
    let mut command = Command::new(helper);
    command.arg(audio).arg(locale).kill_on_drop(true);
    let output = tokio::time::timeout(HELPER_TIMEOUT, command.output())
        .await
        .context("local transcription timed out")?
        .with_context(|| format!("could not launch Apple speech helper {}", helper.display()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("Apple speech transcription failed: {}", stderr.trim());
    }
    serde_json::from_slice(&output.stdout)
        .context("the Apple speech helper returned an invalid response")
}

#[cfg(target_os = "macos")]
fn write_private_file(path: &Path, bytes: &[u8]) -> Result<()> {
    std::fs::write(path, bytes)
        .with_context(|| format!("could not write temporary file {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn source_fingerprint(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, byte| {
        hash.wrapping_mul(0x100000001b3) ^ u64::from(*byte)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_wav() -> Vec<u8> {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&38u32.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&16_000u32.to_le_bytes());
        wav.extend_from_slice(&32_000u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&2u32.to_le_bytes());
        wav.extend_from_slice(&0i16.to_le_bytes());
        wav
    }

    #[test]
    fn accepts_bounded_pcm_wav() {
        validate_wav(&tiny_wav()).unwrap();
    }

    #[test]
    fn rejects_empty_and_truncated_wav_files() {
        assert!(validate_wav(b"not audio").is_err());
        let mut wav = tiny_wav();
        wav.truncate(wav.len() - 1);
        assert!(validate_wav(&wav).is_err());
    }

    #[test]
    fn validates_bcp_47_style_locale() {
        validate_locale("en-US").unwrap();
        validate_locale("pt_BR").unwrap();
        assert!(validate_locale("").is_err());
        assert!(validate_locale("en/../../tmp").is_err());
    }
}
