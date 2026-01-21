mod audio;
mod keychain;
mod providers;
mod translate;
mod whisper;

use providers::{ModelInfo, ProviderConfig, TranslationProvider};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Application state shared across commands
pub struct AppState {
    pub is_recording: Mutex<bool>,
    pub anthropic_api_key: Mutex<Option<String>>,
    pub whisper_model_path: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            is_recording: Mutex::new(false),
            anthropic_api_key: Mutex::new(None),
            whisper_model_path: Mutex::new(None),
        }
    }
}

/// Translation entry for history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationEntry {
    pub id: String,
    pub original_text: String,
    pub translated_text: String,
    pub source_language: String,
    pub target_language: String,
    pub timestamp: String,
}

/// Settings for the application
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub recording_mode: String,           // "push_to_talk" or "click_to_record"
    pub whisper_model: String,            // "small", "medium", "large"
    pub source_language: String,          // "auto", "en", "es", etc.
    pub target_language: String,
    pub translation_provider: String,     // "anthropic", "openai", "google", "ollama"
    pub translation_model: Option<String>, // Optional model override
    #[serde(default = "default_translation_enabled")]
    pub translation_enabled: bool,        // Enable/disable translation (transcription-only mode)
}

fn default_translation_enabled() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            recording_mode: "click_to_record".to_string(),
            whisper_model: "small".to_string(),
            source_language: "auto".to_string(),  // Default to auto-detect
            target_language: "en".to_string(),
            translation_provider: "openai".to_string(), // Default to GPT-4o-mini (cheapest)
            translation_model: None,
            translation_enabled: true,
        }
    }
}

// Re-export commands from modules
pub use audio::{get_audio_devices, start_recording, stop_recording};
pub use keychain::{delete_api_key, get_api_key, save_api_key, validate_api_key};
pub use whisper::{download_whisper_model, get_whisper_model_status, transcribe_audio};

/// Check if the app is currently recording
#[tauri::command]
fn is_recording(state: State<AppState>) -> bool {
    *state.is_recording.lock().unwrap()
}

/// Get the settings file path
fn get_settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let config_dir = home.join(".whisper-translate");
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    Ok(config_dir.join("settings.json"))
}

/// Get current app settings
#[tauri::command]
fn get_settings() -> AppSettings {
    match get_settings_path() {
        Ok(path) => {
            if path.exists() {
                match fs::read_to_string(&path) {
                    Ok(content) => {
                        match serde_json::from_str(&content) {
                            Ok(settings) => {
                                log::info!("Loaded settings from {:?}", path);
                                settings
                            }
                            Err(e) => {
                                log::warn!("Failed to parse settings file: {}. Using defaults.", e);
                                AppSettings::default()
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Failed to read settings file: {}. Using defaults.", e);
                        AppSettings::default()
                    }
                }
            } else {
                log::info!("No settings file found, using defaults");
                AppSettings::default()
            }
        }
        Err(e) => {
            log::warn!("Failed to get settings path: {}. Using defaults.", e);
            AppSettings::default()
        }
    }
}

/// Save app settings
#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = get_settings_path()?;
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write settings file: {}", e))?;
    log::info!("Settings saved to {:?}", path);
    Ok(())
}

/// Translate text using the specified provider
#[tauri::command]
async fn translate_text(
    text: String,
    source_language: String,
    target_language: String,
    provider: String,
    model: Option<String>,
    api_key: Option<String>,
) -> Result<providers::TranslationResult, String> {
    let translation_provider = match provider.as_str() {
        "anthropic" => TranslationProvider::Anthropic,
        "openai" => TranslationProvider::OpenAI,
        "google" => TranslationProvider::Google,
        "ollama" => TranslationProvider::Ollama,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    let config = ProviderConfig {
        provider: translation_provider,
        model,
        api_key,
        ollama_url: None, // Use default localhost:11434
    };

    providers::translate(&config, &text, &source_language, &target_language).await
}

/// Get available models for a provider
#[tauri::command]
fn get_provider_models(provider: String) -> Result<Vec<ModelInfo>, String> {
    let translation_provider = match provider.as_str() {
        "anthropic" => TranslationProvider::Anthropic,
        "openai" => TranslationProvider::OpenAI,
        "google" => TranslationProvider::Google,
        "ollama" => TranslationProvider::Ollama,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    Ok(translation_provider.available_models())
}

/// Get provider information (API key URL, whether key is required, etc.)
#[tauri::command]
fn get_provider_info(provider: String) -> Result<ProviderInfo, String> {
    let translation_provider = match provider.as_str() {
        "anthropic" => TranslationProvider::Anthropic,
        "openai" => TranslationProvider::OpenAI,
        "google" => TranslationProvider::Google,
        "ollama" => TranslationProvider::Ollama,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    Ok(ProviderInfo {
        api_key_url: translation_provider.api_key_url().to_string(),
        requires_api_key: translation_provider.requires_api_key(),
        default_model: translation_provider.default_model().to_string(),
    })
}

#[derive(Debug, Serialize)]
pub struct ProviderInfo {
    pub api_key_url: String,
    pub requires_api_key: bool,
    pub default_model: String,
}

/// Check if Ollama is running
#[tauri::command]
async fn check_ollama_status() -> Result<OllamaStatus, String> {
    let is_running = providers::check_ollama_running().await;

    if is_running {
        match providers::list_ollama_models().await {
            Ok(models) => Ok(OllamaStatus {
                is_running: true,
                models: models.into_iter().map(|m| m.name).collect(),
                error: None,
            }),
            Err(e) => Ok(OllamaStatus {
                is_running: true,
                models: vec![],
                error: Some(e),
            }),
        }
    } else {
        Ok(OllamaStatus {
            is_running: false,
            models: vec![],
            error: Some("Ollama is not running".to_string()),
        })
    }
}

#[derive(Debug, Serialize)]
pub struct OllamaStatus {
    pub is_running: bool,
    pub models: Vec<String>,
    pub error: Option<String>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            // Audio commands
            start_recording,
            stop_recording,
            get_audio_devices,
            is_recording,
            // Keychain commands
            save_api_key,
            get_api_key,
            delete_api_key,
            validate_api_key,
            // Whisper commands
            transcribe_audio,
            download_whisper_model,
            get_whisper_model_status,
            // Translation commands
            translate_text,
            get_provider_models,
            get_provider_info,
            check_ollama_status,
            // Settings commands
            get_settings,
            save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
