mod audio;
mod keychain;
mod providers;
mod translate;
mod whisper;

use arboard::Clipboard;
use providers::{ModelInfo, ProviderConfig, TranslationProvider};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

#[cfg(target_os = "macos")]
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

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
    #[serde(default = "default_remove_filler_words")]
    pub remove_filler_words: bool,        // Remove um, uh, like, etc. from transcriptions
    #[serde(default = "default_global_hotkey_enabled")]
    pub global_hotkey_enabled: bool,      // Enable system-wide hotkey for recording
    #[serde(default = "default_global_hotkey")]
    pub global_hotkey: String,            // The hotkey combination (e.g., "CommandOrControl+Shift+Space")
}

fn default_translation_enabled() -> bool {
    true
}

fn default_remove_filler_words() -> bool {
    false
}

fn default_global_hotkey_enabled() -> bool {
    false
}

fn default_global_hotkey() -> String {
    "CommandOrControl+Shift+Space".to_string()
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
            remove_filler_words: false,
            global_hotkey_enabled: false,
            global_hotkey: "CommandOrControl+Shift+Space".to_string(),
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

/// Copy text to clipboard and simulate paste (Cmd+V on macOS)
#[tauri::command]
async fn copy_and_paste(text: String) -> Result<(), String> {
    // Copy to clipboard
    let mut clipboard = Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
    clipboard.set_text(&text).map_err(|e| format!("Failed to copy to clipboard: {}", e))?;

    // Small delay to ensure clipboard is ready
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // Simulate Cmd+V paste
    #[cfg(target_os = "macos")]
    {
        simulate_paste_macos().map_err(|e| format!("Failed to paste: {}", e))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        return Err("Auto-paste only supported on macOS".to_string());
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn simulate_paste_macos() -> Result<(), String> {
    // Key code for 'V' on macOS
    const V_KEY: CGKeyCode = 9;

    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| "Failed to create event source")?;

    // Create key down event for 'V'
    let key_down = CGEvent::new_keyboard_event(source.clone(), V_KEY, true)
        .map_err(|_| "Failed to create key down event")?;

    // Create key up event for 'V'
    let key_up = CGEvent::new_keyboard_event(source, V_KEY, false)
        .map_err(|_| "Failed to create key up event")?;

    // Set Command flag (Cmd+V)
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);

    // Post the events
    key_down.post(CGEventTapLocation::HID);

    // Small delay between key down and up
    std::thread::sleep(std::time::Duration::from_millis(10));

    key_up.post(CGEventTapLocation::HID);

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
            // Clipboard commands
            copy_and_paste,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
