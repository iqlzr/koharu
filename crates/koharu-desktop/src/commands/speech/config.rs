use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize, Type)]
#[serde(default)]
pub struct SpeechConfig {
    pub endpoint: String,
    pub executable_path: String,
    pub speaker_id: u32,
    pub speed_scale: f32,
}

impl Default for SpeechConfig {
    fn default() -> Self {
        Self {
            endpoint: "http://127.0.0.1:50021".to_string(),
            executable_path: r"G:\voicevox-engine\run.exe".to_string(),
            speaker_id: 3,
            speed_scale: 1.0,
        }
    }
}

impl koharu_config::Section for SpeechConfig {
    const NAME: &'static str = "speech";
}
