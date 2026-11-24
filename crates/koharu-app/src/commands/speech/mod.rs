pub mod config;

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::process::Command;
use std::time::Duration;

use super::Error;
pub use config::SpeechConfig;

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct VoiceSpeakerStyle {
    pub id: u32,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct VoiceSpeaker {
    pub name: String,
    pub speaker_uuid: String,
    pub styles: Vec<VoiceSpeakerStyle>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Type)]
pub struct SpeechServiceStatus {
    pub running: bool,
    pub message: Option<String>,
}

fn client(timeout: Duration) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .context("failed to build HTTP client")
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn get_speech_speakers(
    endpoint: Option<String>,
) -> std::result::Result<Vec<VoiceSpeaker>, Error> {
    let endpoint = match endpoint {
        Some(ep) if !ep.trim().is_empty() => ep,
        _ => {
            let config = SpeechConfig::load()?;
            config.read()?.endpoint.clone()
        }
    };
    let url = format!("{}/speakers", endpoint.trim_end_matches('/'));
    let http = client(Duration::from_secs(3))?;
    let response = http
        .get(&url)
        .send()
        .await
        .context("failed to connect to VOICEVOX service")?;
    if !response.status().is_success() {
        return Err(anyhow!(
            "VOICEVOX error {}: {}",
            response.status(),
            response.text().await.unwrap_or_default()
        )
        .into());
    }
    let speakers: Vec<VoiceSpeaker> = response
        .json()
        .await
        .context("failed to parse speakers JSON")?;
    Ok(speakers)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn check_speech_service(
    endpoint: Option<String>,
) -> std::result::Result<SpeechServiceStatus, Error> {
    let endpoint = match endpoint {
        Some(ep) if !ep.trim().is_empty() => ep,
        _ => {
            let config = SpeechConfig::load()?;
            config.read()?.endpoint.clone()
        }
    };
    let url = format!("{}/version", endpoint.trim_end_matches('/'));
    let http = client(Duration::from_secs(2))?;
    match http.get(&url).send().await {
        Ok(res) if res.status().is_success() => {
            let version = res.text().await.unwrap_or_default();
            Ok(SpeechServiceStatus {
                running: true,
                message: Some(format!("VOICEVOX {}", version.trim())),
            })
        }
        Ok(res) => Ok(SpeechServiceStatus {
            running: false,
            message: Some(format!("HTTP {}", res.status())),
        }),
        Err(err) => Ok(SpeechServiceStatus {
            running: false,
            message: Some(err.to_string()),
        }),
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn start_speech_service(
    executable_path: Option<String>,
) -> std::result::Result<SpeechServiceStatus, Error> {
    let path = match executable_path {
        Some(p) if !p.trim().is_empty() => p,
        _ => {
            let config = SpeechConfig::load()?;
            config.read()?.executable_path.clone()
        }
    };

    let exe_path = std::path::Path::new(&path);
    if !exe_path.exists() {
        return Err(anyhow!("VOICEVOX executable not found at '{}'", path).into());
    }

    let exe_dir = exe_path.parent().unwrap_or(exe_path);

    let mut command = Command::new(&path);
    command.current_dir(exe_dir);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW = 0x08000000, DETACHED_PROCESS = 0x00000008
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .with_context(|| format!("failed to spawn VOICEVOX process '{}'", path))?;

    // Wait briefly up to 3 seconds for service to answer
    let config = SpeechConfig::load()?;
    let endpoint = config.read()?.endpoint.clone();
    let url = format!("{}/version", endpoint.trim_end_matches('/'));
    let http = client(Duration::from_millis(500))?;

    for _ in 0..10 {
        tokio::time::sleep(Duration::from_millis(300)).await;
        if let Ok(res) = http.get(&url).send().await {
            if res.status().is_success() {
                let ver = res.text().await.unwrap_or_default();
                return Ok(SpeechServiceStatus {
                    running: true,
                    message: Some(format!("VOICEVOX {} started", ver.trim())),
                });
            }
        }
    }

    Ok(SpeechServiceStatus {
        running: true,
        message: Some("Process launched".to_string()),
    })
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn synthesize_speech(
    text: String,
    speaker_id: Option<u32>,
    speed_scale: Option<f32>,
) -> std::result::Result<Vec<u8>, Error> {
    let text = text.trim();
    if text.is_empty() {
        return Err(anyhow!("text cannot be empty").into());
    }

    let config = SpeechConfig::load()?;
    let config = config.read()?.clone();

    let speaker = speaker_id.unwrap_or(config.speaker_id);
    let speed = speed_scale.unwrap_or(config.speed_scale);
    let endpoint = config.endpoint.trim_end_matches('/');

    let http = client(Duration::from_secs(30))?;

    // 1. Audio query
    let query_url = format!("{}/audio_query", endpoint);
    let mut query: serde_json::Value = http
        .post(&query_url)
        .query(&[("text", text), ("speaker", &speaker.to_string())])
        .send()
        .await
        .context("audio_query request failed")?
        .error_for_status()
        .context("audio_query returned error")?
        .json()
        .await
        .context("failed to parse audio_query response")?;

    if let Some(obj) = query.as_object_mut() {
        obj.insert("speedScale".to_string(), serde_json::json!(speed));
    }

    // 2. Synthesis
    let synth_url = format!("{}/synthesis?speaker={}", endpoint, speaker);
    let wav_bytes = http
        .post(&synth_url)
        .json(&query)
        .send()
        .await
        .context("synthesis request failed")?
        .error_for_status()
        .context("synthesis returned error")?
        .bytes()
        .await
        .context("failed to read synthesized audio bytes")?;

    Ok(wav_bytes.to_vec())
}
